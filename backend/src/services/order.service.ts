import crypto from 'crypto';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { Cart } from '../models/cart.model';
import { Order, type IOrder, type IOrderItem } from '../models/order.model';
import { User } from '../models/user.model';
import * as productRepository from '../repositories/product.repository';
import { effectivePriceFor, priceTierFor } from '../serializers/product.serializer';
import { ApiError } from '../utils/ApiError';
import { PERMISSIONS, isProductVisibleTo } from '../utils/rbac';
import { ORDER_STATUS_TRANSITIONS, type OrderStatus, type PaymentMethod } from '../types';
import type { AuthenticatedUser } from '../types';
import * as codService from './cod.service';
import * as paymentService from './payment.service';

/* ── Serialization ──────────────────────────────────────────────────────── */

export interface SerializedOrder {
  id: string;
  orderNumber: string;
  items: Array<{
    productId: string;
    name: string;
    image?: string;
    quantity: number;
    priceAtOrder: number;
    lineTotal: number;
    priceTier: 'retail' | 'wholesale';
  }>;
  shippingAddress: IOrder['shippingAddress'];
  paymentMethod: PaymentMethod;
  paymentStatus: IOrder['paymentStatus'];
  subtotal: number;
  shippingCharge: number;
  totalAmount: number;
  currency: string;
  orderStatus: OrderStatus;
  statusHistory: Array<{ status: OrderStatus; at: string; note?: string }>;
  /** The customer may cancel it outright (still placed, nothing paid). */
  cancellable: boolean;
  /**
   * Paid and not yet shipped: the customer cannot cancel (that would owe a
   * refund) but may ASK the store to, which is recorded in cancellationRequest.
   */
  cancellationRequestable: boolean;
  cancellationRequest?: { requestedAt: string; reason?: string };
  /**
   * Where the money stands on a paid order that did not go ahead:
   *   due      — cancelled after payment, no refund sent yet
   *   pending  — refund sent, Razorpay has not confirmed it
   *   refunded — money returned
   *   failed   — the refund attempt failed; retry from admin
   *   none     — nothing owed
   */
  refundState: 'none' | 'due' | 'pending' | 'refunded' | 'failed';
  refund?: { status: string; amount?: number; failureReason?: string; processedAt?: string };
  /** Payment was captured after the order had been cancelled or expired. */
  lateCapture: boolean;
  /** True for a "Buy now" order, so the client knows not to clear its cart. */
  fromBuyNow: boolean;
  customer?: { id: string; name?: string; phone: string };
  createdAt: string;
  updatedAt: string;
}

export function serializeOrder(
  order: IOrder,
  options: { includeCustomer?: boolean } = {},
): SerializedOrder {
  const populatedUser = order.userId as unknown as
    | { _id: { toString(): string }; name?: string; phone: string }
    | undefined;

  return {
    id: order._id.toString(),
    orderNumber: order.orderNumber,
    items: order.items.map((item) => ({
      productId: item.productId.toString(),
      name: item.name,
      image: item.image,
      quantity: item.quantity,
      priceAtOrder: item.priceAtOrder,
      lineTotal: item.priceAtOrder * item.quantity,
      priceTier: item.priceTier,
    })),
    shippingAddress: order.shippingAddress,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    subtotal: order.subtotal,
    shippingCharge: order.shippingCharge,
    totalAmount: order.totalAmount,
    currency: order.currency,
    orderStatus: order.orderStatus,
    statusHistory: order.statusHistory.map((event) => ({
      status: event.status,
      at: event.at.toISOString(),
      note: event.note,
    })),
    // PRD 4.5 — cancellable only while still "placed", before processing
    // begins, and only while nothing has been paid (a paid order needs a refund,
    // which the store handles).
    cancellable: order.orderStatus === 'placed' && order.paymentStatus !== 'paid',
    cancellationRequestable:
      order.paymentStatus === 'paid' &&
      (order.orderStatus === 'placed' || order.orderStatus === 'processing') &&
      !order.cancellationRequest?.requestedAt,
    ...(order.cancellationRequest?.requestedAt
      ? {
          cancellationRequest: {
            requestedAt: order.cancellationRequest.requestedAt.toISOString(),
            reason: order.cancellationRequest.reason,
          },
        }
      : {}),
    refundState: refundStateOf(order),
    ...(order.refund?.status
      ? {
          refund: {
            status: order.refund.status,
            amount: order.refund.amount,
            failureReason: order.refund.failureReason,
            processedAt: order.refund.processedAt?.toISOString(),
          },
        }
      : {}),
    lateCapture: order.payment?.lateCapture === true,
    fromBuyNow: order.fromBuyNow ?? false,
    ...(options.includeCustomer && populatedUser && 'phone' in populatedUser
      ? {
          customer: {
            id: populatedUser._id.toString(),
            name: populatedUser.name,
            phone: populatedUser.phone,
          },
        }
      : {}),
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
  };
}

function refundStateOf(order: IOrder): SerializedOrder['refundState'] {
  const status = order.refund?.status;
  if (status === 'processed' || order.paymentStatus === 'refunded') return 'refunded';
  if (status === 'initiating' || status === 'pending') return 'pending';
  if (status === 'failed') return 'failed';
  if (order.paymentStatus === 'paid' && order.orderStatus === 'cancelled') return 'due';
  return 'none';
}

/* ── Checkout ───────────────────────────────────────────────────────────── */

function generateOrderNumber(): string {
  const date = new Date();
  const stamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(
    date.getDate(),
  ).padStart(2, '0')}`;
  const random = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `MF-${stamp}-${random}`;
}

export interface CheckoutInput {
  addressId: string;
  paymentMethod: PaymentMethod;
  /**
   * "Buy now" — order this one product instead of the saved cart. The cart is
   * neither read nor cleared, so a customer holding five items who buys a
   * single piece pays for that piece alone.
   */
  buyNow?: { productId: string; quantity: number };
}

export interface CheckoutResult {
  order: SerializedOrder;
  /** Present for Razorpay orders — handed straight to the Razorpay checkout SDK. */
  payment?: paymentService.RazorpayOrderHandle;
}

/**
 * PRD 4.3 / 4.4 — builds an order from the server-side cart.
 *
 * Prices are read from the product documents at the buyer's tier and frozen
 * onto the order as priceAtOrder (PRD 8.2 price protection). The client never
 * supplies a price or a total — and, since COD became state-dependent, never
 * supplies the shipping charge or the state it is derived from either.
 */
export async function checkout(
  viewer: AuthenticatedUser,
  input: CheckoutInput,
): Promise<CheckoutResult> {
  const user = await User.findById(viewer.id);
  if (!user) throw ApiError.notFound('Account not found');

  const address = user.addresses.id(input.addressId);
  if (!address) throw ApiError.badRequest('Select a valid delivery address');

  // One order builder, two sources. A Buy-now order skips the cart lookup
  // entirely rather than reading and ignoring it.
  const buyNow = input.buyNow;
  const lines: Array<{ productId: string; quantity: number }> = [];

  if (buyNow) {
    lines.push({ productId: buyNow.productId, quantity: buyNow.quantity });
  } else {
    const cart = await Cart.findOne({ userId: viewer.id });
    if (!cart || cart.items.length === 0) throw ApiError.badRequest('Your cart is empty');
    for (const item of cart.items) {
      lines.push({ productId: item.productId.toString(), quantity: item.quantity });
    }
  }

  const products = await productRepository.findManyByIds(lines.map((line) => line.productId));
  const productsById = new Map(products.map((product) => [product._id.toString(), product]));

  const items: IOrderItem[] = [];
  for (const line of lines) {
    const product = productsById.get(line.productId);
    // Visibility is checked here as well as at add-to-cart: this is the last
    // point before money, and a Buy-now line never passed through the cart at
    // all. Without it the product id alone would be enough to order a piece the
    // buyer's storefront excludes, at their own tier's price.
    if (!product || !product.isActive || !isProductVisibleTo(product.visibility, viewer)) {
      throw ApiError.conflict(
        buyNow
          ? 'This product is no longer available.'
          : 'An item in your cart is no longer available. Please review your cart.',
      );
    }
    if (product.stock < line.quantity) {
      throw ApiError.conflict(
        buyNow
          ? `"${product.name}" only has ${product.stock} left.`
          : `"${product.name}" only has ${product.stock} left. Please update your cart.`,
      );
    }

    items.push({
      productId: product._id,
      name: product.name,
      image: product.images[0],
      quantity: line.quantity,
      priceAtOrder: effectivePriceFor(product, viewer),
      priceTier: priceTierFor(viewer),
    });
  }

  const subtotal = items.reduce((sum, item) => sum + item.priceAtOrder * item.quantity, 0);
  // Shipping is priced from the *saved* address's state, never from anything
  // the client sent: the request carries an address id and a payment method
  // and nothing else, so a COD charge cannot be lowered and COD cannot be
  // forced in a state where the store has switched it off. A disabled state
  // throws COD_UNAVAILABLE here, before any stock is reserved.
  const { shippingCharge } = await codService.resolveShipping(input.paymentMethod, address.state);
  const totalAmount = subtotal + shippingCharge;

  // Reserve stock before creating the order so two concurrent checkouts cannot
  // oversell. Anything that fails afterwards restores what was taken.
  const reserved: Array<{ productId: string; quantity: number }> = [];
  try {
    for (const item of items) {
      const ok = await productRepository.decrementStock(item.productId.toString(), item.quantity);
      if (!ok) {
        throw ApiError.conflict(`"${item.name}" just went out of stock. Please update your cart.`);
      }
      reserved.push({ productId: item.productId.toString(), quantity: item.quantity });
    }

    const order = await Order.create({
      orderNumber: generateOrderNumber(),
      userId: user._id,
      items,
      shippingAddress: {
        fullName: address.fullName,
        phone: address.phone,
        line1: address.line1,
        line2: address.line2,
        city: address.city,
        state: address.state,
        pincode: address.pincode,
      },
      paymentMethod: input.paymentMethod,
      paymentStatus: 'pending',
      subtotal,
      shippingCharge,
      totalAmount,
      currency: env.CURRENCY,
      orderStatus: 'placed',
      statusHistory: [{ status: 'placed', at: new Date() }],
      fromBuyNow: Boolean(buyNow),
    });

    if (input.paymentMethod === 'razorpay') {
      const handle = await paymentService.createRazorpayOrder(totalAmount, order.orderNumber);
      order.payment = { razorpayOrderId: handle.razorpayOrderId };
      await order.save();
      // The cart is deliberately kept until payment succeeds, so an abandoned
      // payment leaves the customer's cart intact.
      return { order: serializeOrder(order), payment: handle };
    }

    // Only a cart checkout empties the cart. A Buy-now order never read it.
    if (!buyNow) await Cart.updateOne({ userId: viewer.id }, { $set: { items: [] } });
    return { order: serializeOrder(order) };
  } catch (error) {
    for (const entry of reserved) {
      await productRepository.incrementStock(entry.productId, entry.quantity);
    }
    throw error;
  }
}

/**
 * PRD 4.4 — confirms the Razorpay checkout handshake. The signature is verified
 * server-side; a client claiming "paid" without a valid signature is rejected.
 */
export async function confirmPayment(
  viewer: AuthenticatedUser,
  input: { orderId: string; razorpayPaymentId: string; razorpaySignature: string },
): Promise<SerializedOrder> {
  const order = await Order.findOne({ _id: input.orderId, userId: viewer.id });
  if (!order) throw ApiError.notFound('Order not found');
  if (order.paymentStatus === 'paid' || order.paymentStatus === 'refunded') return serializeOrder(order);
  if (!order.payment?.razorpayOrderId) {
    throw ApiError.badRequest('This order has no online payment attached');
  }

  const valid = paymentService.verifyPaymentSignature({
    razorpayOrderId: order.payment.razorpayOrderId,
    razorpayPaymentId: input.razorpayPaymentId,
    razorpaySignature: input.razorpaySignature,
  });

  if (!valid) {
    order.paymentStatus = 'failed';
    order.payment.failureReason = 'Signature verification failed';
    await order.save();
    throw ApiError.badRequest('Payment could not be verified');
  }

  // Paid for an order that no longer exists (expired, or cancelled while the
  // payment was in flight): record the money and send it straight back.
  if (order.orderStatus === 'cancelled') {
    await recordLateCapture(order, input.razorpayPaymentId);
    throw ApiError.conflict(
      'This order was cancelled before your payment completed. Your payment is being refunded — no action needed.',
    );
  }

  order.paymentStatus = 'paid';
  order.payment.razorpayPaymentId = input.razorpayPaymentId;
  order.payment.razorpaySignature = input.razorpaySignature;
  order.payment.paidAt = new Date();
  await order.save();

  // A Buy-now order was never built from the cart, so clearing it here would
  // silently delete items the customer has not checked out.
  if (!order.fromBuyNow) {
    await Cart.updateOne({ userId: viewer.id }, { $set: { items: [] } });
  }

  return serializeOrder(order);
}

/**
 * Money captured for an order that was already cancelled or expired. Never
 * kept silently: the payment is recorded, flagged, and refunded. If the
 * refund cannot be sent, the order shows "Refund failed" to admin.
 */
async function recordLateCapture(order: IOrder, razorpayPaymentId: string | undefined): Promise<void> {
  logger.warn(`Payment captured after order ${order.orderNumber} was ${order.orderStatus}; refunding.`);
  order.paymentStatus = 'paid';
  order.payment = {
    ...order.payment,
    razorpayPaymentId: razorpayPaymentId ?? order.payment?.razorpayPaymentId,
    paidAt: new Date(),
    lateCapture: true,
  };
  await order.save();
  await refundOrder(order._id.toString());
}

/**
 * PRD 4.4 — webhook handling. The webhook is authoritative: it arrives even if
 * the app is killed mid-payment, so it must reach the same end state as
 * confirmPayment.
 */
export async function handlePaymentWebhook(event: {
  event: string;
  payload: {
    payment?: { entity?: { order_id?: string; id?: string; error_description?: string } };
    refund?: { entity?: { id?: string; payment_id?: string; status?: string; amount?: number } };
  };
}): Promise<void> {
  if (event.event === 'refund.processed' || event.event === 'refund.failed') {
    await handleRefundWebhook(event.event, event.payload?.refund?.entity);
    return;
  }

  const entity = event.payload?.payment?.entity;
  const razorpayOrderId = entity?.order_id;
  if (!razorpayOrderId) return;

  const order = await Order.findOne({ 'payment.razorpayOrderId': razorpayOrderId });
  if (!order) {
    logger.warn(`Webhook for unknown Razorpay order ${razorpayOrderId}`);
    return;
  }

  if (
    event.event === 'payment.captured' &&
    order.orderStatus === 'cancelled' &&
    order.paymentStatus !== 'paid' &&
    order.paymentStatus !== 'refunded'
  ) {
    await recordLateCapture(order, entity?.id);
    return;
  }

  if (event.event === 'payment.captured' && order.paymentStatus !== 'paid' && order.paymentStatus !== 'refunded') {
    order.paymentStatus = 'paid';
    order.payment = {
      ...order.payment,
      razorpayPaymentId: entity?.id,
      paidAt: new Date(),
    };
    await order.save();
    // Same rule as confirmPayment: a Buy-now order leaves the cart alone.
    if (!order.fromBuyNow) {
      await Cart.updateOne({ userId: order.userId }, { $set: { items: [] } });
    }
    return;
  }

  if (event.event === 'payment.failed' && order.paymentStatus === 'pending') {
    order.paymentStatus = 'failed';
    order.payment = {
      ...order.payment,
      failureReason: entity?.error_description ?? 'Payment failed',
    };
    // Release the stock this abandoned order was holding.
    await releaseStock(order);
    order.orderStatus = 'cancelled';
    order.cancelledAt = new Date();
    order.cancellationReason = 'Payment failed';
    order.statusHistory.push({ status: 'cancelled', at: new Date(), note: 'Payment failed' });
    await order.save();
  }
}

/**
 * refund.processed / refund.failed. Finds the order by the refund id, or by
 * the payment when the refund was raised outside the app (Razorpay dashboard).
 */
async function handleRefundWebhook(
  kind: 'refund.processed' | 'refund.failed',
  refund: { id?: string; payment_id?: string; status?: string; amount?: number } | undefined,
): Promise<void> {
  if (!refund?.id) return;
  const order =
    (await Order.findOne({ 'refund.razorpayRefundId': refund.id })) ??
    (refund.payment_id ? await Order.findOne({ 'payment.razorpayPaymentId': refund.payment_id }) : null);
  if (!order) {
    logger.warn(`Refund webhook for unknown refund ${refund.id}`);
    return;
  }
  // Already final: a replayed or out-of-order event changes nothing.
  if (order.refund?.status === 'processed') return;

  const base = {
    attempts: order.refund?.attempts ?? 0,
    initiatedAt: order.refund?.initiatedAt ?? new Date(),
    razorpayRefundId: refund.id,
    amount: refund.amount ?? order.refund?.amount,
  };
  if (kind === 'refund.processed') {
    order.refund = { ...base, status: 'processed', processedAt: new Date() };
    order.paymentStatus = 'refunded';
  } else {
    order.refund = { ...base, status: 'failed', failureReason: 'Razorpay reported the refund as failed' };
  }
  await order.save();
}

/**
 * Sends a paid order's money back. Safe to call more than once, from any path.
 *
 *  - Claimed atomically: only one caller can move the refund to "initiating",
 *    so two admins (or the admin and the late-capture path) cannot both pay out.
 *  - Before calling Razorpay, looks for a refund already raised for this
 *    order, in case an earlier attempt reached Razorpay but its answer was
 *    lost. That refund is adopted instead of sending a second one.
 *  - A failure is recorded, not thrown: the order shows "Refund failed" and
 *    admin can retry.
 */
export async function refundOrder(orderId: string): Promise<IOrder | null> {
  const claimed = await Order.findOneAndUpdate(
    {
      _id: orderId,
      paymentMethod: 'razorpay',
      paymentStatus: 'paid',
      'payment.razorpayPaymentId': { $exists: true },
      $or: [{ 'refund.status': { $exists: false } }, { 'refund.status': 'failed' }],
    },
    {
      $set: { 'refund.status': 'initiating', 'refund.initiatedAt': new Date() },
      $unset: { 'refund.failureReason': 1 },
      $inc: { 'refund.attempts': 1 },
    },
    { new: true },
  );
  if (!claimed) return Order.findById(orderId);

  const paymentId = claimed.payment?.razorpayPaymentId as string;
  try {
    const outcome =
      (await paymentService.findExistingRefund(paymentId, claimed.orderNumber)) ??
      (await paymentService.refundPayment({
        razorpayPaymentId: paymentId,
        amountInPaise: claimed.totalAmount,
        orderNumber: claimed.orderNumber,
      }));
    return Order.findByIdAndUpdate(
      orderId,
      {
        $set: {
          'refund.status': outcome.status,
          'refund.razorpayRefundId': outcome.razorpayRefundId,
          'refund.amount': outcome.amount,
          ...(outcome.status === 'processed'
            ? { 'refund.processedAt': new Date(), paymentStatus: 'refunded' }
            : {}),
        },
      },
      { new: true },
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logger.error(`Refund for order ${claimed.orderNumber} failed`, error);
    return Order.findByIdAndUpdate(
      orderId,
      { $set: { 'refund.status': 'failed', 'refund.failureReason': reason.slice(0, 500) } },
      { new: true },
    );
  }
}

/** Admin "Retry refund" on a cancelled paid order whose refund is due or failed. */
export async function retryRefund(orderId: string): Promise<SerializedOrder> {
  const order = await Order.findById(orderId);
  if (!order) throw ApiError.notFound('Order not found');
  if (order.orderStatus !== 'cancelled' || order.paymentStatus !== 'paid') {
    throw ApiError.conflict('Only a cancelled order that was paid online can be refunded.');
  }
  const updated = await refundOrder(orderId);
  const populated = await Order.findById(updated?._id ?? orderId).populate('userId', 'name phone');
  return serializeOrder(populated as IOrder, { includeCustomer: true });
}

/**
 * Credits this order's stock back, at most once.
 *
 * The customer, the store and the payment.failed webhook can all cancel the
 * same order — a customer who cancels a pending online payment still gets the
 * webhook afterwards — so without the marker the pieces would be counted back
 * in twice and the catalogue would claim stock it does not have. The caller
 * saves the order; setting the marker here keeps every path honest.
 */
async function releaseStock(order: IOrder): Promise<void> {
  if (order.stockReleasedAt) return;
  const releasedAt = new Date();
  // Claimed in the database, not just on this document: the expiry sweep, a
  // webhook and an admin can race on the same order across requests.
  const claim = await Order.updateOne(
    { _id: order._id, stockReleasedAt: { $exists: false } },
    { $set: { stockReleasedAt: releasedAt } },
  );
  order.stockReleasedAt = releasedAt;
  if (claim.modifiedCount !== 1) return;

  for (const item of order.items) {
    await productRepository.incrementStock(item.productId.toString(), item.quantity);
  }
}

/* ── Reads ──────────────────────────────────────────────────────────────── */

export async function listMyOrders(userId: string, page = 1, limit = 20) {
  const skip = (page - 1) * limit;
  const [orders, total] = await Promise.all([
    Order.find({ userId }).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Order.countDocuments({ userId }),
  ]);

  return {
    items: orders.map((order) => serializeOrder(order)),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      hasMore: page * limit < total,
    },
  };
}

export async function getMyOrder(userId: string, orderId: string): Promise<SerializedOrder> {
  const order = await Order.findOne({ _id: orderId, userId });
  if (!order) throw ApiError.notFound('Order not found');
  return serializeOrder(order);
}

export async function listAllOrders(filters: {
  page: number;
  limit: number;
  status?: OrderStatus;
  search?: string;
}) {
  const query: Record<string, unknown> = {};
  if (filters.status) query.orderStatus = filters.status;
  if (filters.search) {
    // Escaped, not interpolated: an order number typed with a bracket or a
    // paren would otherwise be compiled as a pattern — a syntax error becomes a
    // 500, and a pathological one becomes a slow scan.
    const escaped = filters.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    query.orderNumber = new RegExp(escaped, 'i');
  }

  const skip = (filters.page - 1) * filters.limit;
  const [orders, total] = await Promise.all([
    Order.find(query)
      .populate('userId', 'name phone')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(filters.limit),
    Order.countDocuments(query),
  ]);

  return {
    items: orders.map((order) => serializeOrder(order, { includeCustomer: true })),
    pagination: {
      page: filters.page,
      limit: filters.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / filters.limit)),
      hasMore: filters.page * filters.limit < total,
    },
  };
}

export async function getOrderForAdmin(orderId: string): Promise<SerializedOrder> {
  const order = await Order.findById(orderId).populate('userId', 'name phone');
  if (!order) throw ApiError.notFound('Order not found');
  return serializeOrder(order, { includeCustomer: true });
}

/* ── Status changes ─────────────────────────────────────────────────────── */

/** PRD 4.5 — the customer may cancel only while the order is still "placed". */
export async function cancelMyOrder(
  userId: string,
  orderId: string,
  reason?: string,
): Promise<SerializedOrder> {
  const order = await Order.findOne({ _id: orderId, userId });
  if (!order) throw ApiError.notFound('Order not found');

  // Paid online: cancelling owes a refund, which is the store's decision. The
  // request is recorded (once) for admin, and the order is left as it is.
  if (order.paymentStatus === 'paid') {
    if (order.orderStatus !== 'placed' && order.orderStatus !== 'processing') {
      throw ApiError.conflict('This order has already shipped. Please contact the store about a return.');
    }
    if (!order.cancellationRequest?.requestedAt) {
      order.cancellationRequest = { requestedAt: new Date(), reason };
      order.statusHistory.push({
        status: order.orderStatus,
        at: new Date(),
        note: `Customer requested cancellation${reason ? `: ${reason}` : ''}`,
      });
      await order.save();
    }
    return serializeOrder(order);
  }

  if (order.orderStatus !== 'placed') {
    throw ApiError.conflict(
      order.orderStatus === 'cancelled'
        ? 'This order is already cancelled.'
        : 'This order has already started processing and can no longer be cancelled.',
    );
  }

  await releaseStock(order);
  order.orderStatus = 'cancelled';
  order.cancelledAt = new Date();
  order.cancellationReason = reason ?? 'Cancelled by customer';
  order.statusHistory.push({ status: 'cancelled', at: new Date(), note: order.cancellationReason });
  await order.save();

  return serializeOrder(order);
}

export async function updateOrderStatus(
  actor: AuthenticatedUser,
  orderId: string,
  nextStatus: OrderStatus,
  note?: string,
): Promise<SerializedOrder> {
  const order = await Order.findById(orderId).populate('userId', 'name phone');
  if (!order) throw ApiError.notFound('Order not found');

  const allowed = ORDER_STATUS_TRANSITIONS[order.orderStatus];
  if (!allowed.includes(nextStatus)) {
    throw ApiError.conflict(
      `An order that is "${order.orderStatus}" cannot move to "${nextStatus}".`,
    );
  }

  const paidOnline = order.paymentMethod === 'razorpay' && order.paymentStatus === 'paid';
  if (nextStatus === 'cancelled' && paidOnline && !actor.permissions.includes(PERMISSIONS.ORDER_REFUND)) {
    throw ApiError.forbidden('This order was paid online. Only an admin can cancel it, because cancelling refunds the customer.');
  }

  if (nextStatus === 'cancelled') {
    await releaseStock(order);
    order.cancelledAt = new Date();
    order.cancellationReason = note ?? 'Cancelled by store';
  }

  order.orderStatus = nextStatus;
  order.statusHistory.push({ status: nextStatus, at: new Date(), by: actor.id as never, note });
  await order.save();

  if (nextStatus === 'cancelled' && paidOnline) {
    // Recorded on the order either way; a failure shows as "Refund failed".
    await refundOrder(order._id.toString());
    const refreshed = await Order.findById(order._id).populate('userId', 'name phone');
    return serializeOrder(refreshed as IOrder, { includeCustomer: true });
  }

  return serializeOrder(order, { includeCustomer: true });
}

/* ── Unfinished online payments ─────────────────────────────────────────── */

/**
 * Expires online orders left unpaid for PENDING_PAYMENT_TTL_MINUTES: the order
 * is cancelled with paymentStatus "expired" and its stock goes back on sale.
 *
 * Each order is claimed atomically, so overlapping sweeps (or a sweep racing a
 * webhook) act on it once. Before expiring, Razorpay is asked whether a
 * payment was in fact captured — a late webhook, not an unpaid order — and if
 * so the order is marked paid instead. A capture that arrives AFTER expiry is
 * handled by recordLateCapture (refunded, flagged), never lost.
 */
export async function expireStalePendingOrders(now: Date = new Date()): Promise<{ expired: number; paid: number }> {
  const cutoff = new Date(now.getTime() - env.PENDING_PAYMENT_TTL_MINUTES * 60_000);
  const stale = await Order.find({
    paymentMethod: 'razorpay',
    paymentStatus: 'pending',
    orderStatus: 'placed',
    createdAt: { $lt: cutoff },
  })
    .limit(200)
    .select('_id payment.razorpayOrderId');

  let expired = 0;
  let paid = 0;
  for (const candidate of stale) {
    const razorpayOrderId = candidate.payment?.razorpayOrderId;
    if (razorpayOrderId) {
      const capturedId = await paymentService.capturedPaymentFor(razorpayOrderId);
      if (capturedId) {
        const marked = await Order.findOneAndUpdate(
          { _id: candidate._id, paymentStatus: 'pending' },
          { $set: { paymentStatus: 'paid', 'payment.razorpayPaymentId': capturedId, 'payment.paidAt': now } },
        );
        if (marked) paid += 1;
        continue;
      }
    }

    const claimed = await Order.findOneAndUpdate(
      { _id: candidate._id, paymentStatus: 'pending', orderStatus: 'placed' },
      {
        $set: {
          paymentStatus: 'expired',
          orderStatus: 'cancelled',
          cancelledAt: now,
          cancellationReason: `Payment not completed within ${env.PENDING_PAYMENT_TTL_MINUTES} minutes`,
        },
        $push: {
          statusHistory: {
            status: 'cancelled',
            at: now,
            note: `Payment not completed within ${env.PENDING_PAYMENT_TTL_MINUTES} minutes`,
          },
        },
      },
      { new: true },
    );
    if (!claimed) continue;
    await releaseStock(claimed);
    expired += 1;
  }

  if (expired || paid) logger.info(`Pending-payment sweep: ${expired} expired, ${paid} found paid.`);
  return { expired, paid };
}

let sweepTimer: ReturnType<typeof setInterval> | null = null;

/** Runs the sweep now and every ORDER_EXPIRY_SWEEP_MINUTES. Never in tests. */
export function startPendingPaymentSweep(): void {
  if (sweepTimer || env.NODE_ENV === 'test') return;
  const run = () =>
    expireStalePendingOrders().catch((error) => logger.error('Pending-payment sweep failed', error));
  void run();
  sweepTimer = setInterval(run, env.ORDER_EXPIRY_SWEEP_MINUTES * 60_000);
  // A sleeping or shutting-down process should not be kept alive by this.
  sweepTimer.unref();
}

export function stopPendingPaymentSweep(): void {
  if (sweepTimer) clearInterval(sweepTimer);
  sweepTimer = null;
}
