import crypto from 'crypto';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { Cart } from '../models/cart.model';
import { Order, type IOrder, type IOrderItem } from '../models/order.model';
import { User } from '../models/user.model';
import * as productRepository from '../repositories/product.repository';
import { effectivePriceFor, priceTierFor } from '../serializers/product.serializer';
import { ApiError } from '../utils/ApiError';
import { isProductVisibleTo } from '../utils/rbac';
import { ORDER_STATUS_TRANSITIONS, type OrderStatus, type PaymentMethod } from '../types';
import type { AuthenticatedUser } from '../types';
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
  cancellable: boolean;
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
    // PRD 4.5 — cancellable only while still "placed", before processing begins.
    cancellable: order.orderStatus === 'placed',
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
 * supplies a price or a total.
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
  const shippingCharge = paymentService.shippingChargeFor(input.paymentMethod);
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
  if (order.paymentStatus === 'paid') return serializeOrder(order);
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
 * PRD 4.4 — webhook handling. The webhook is authoritative: it arrives even if
 * the app is killed mid-payment, so it must reach the same end state as
 * confirmPayment.
 */
export async function handlePaymentWebhook(event: {
  event: string;
  payload: { payment?: { entity?: { order_id?: string; id?: string; error_description?: string } } };
}): Promise<void> {
  const entity = event.payload?.payment?.entity;
  const razorpayOrderId = entity?.order_id;
  if (!razorpayOrderId) return;

  const order = await Order.findOne({ 'payment.razorpayOrderId': razorpayOrderId });
  if (!order) {
    logger.warn(`Webhook for unknown Razorpay order ${razorpayOrderId}`);
    return;
  }

  if (event.event === 'payment.captured' && order.paymentStatus !== 'paid') {
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
  order.stockReleasedAt = new Date();

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

  if (nextStatus === 'cancelled') {
    await releaseStock(order);
    order.cancelledAt = new Date();
    order.cancellationReason = note ?? 'Cancelled by store';
  }

  order.orderStatus = nextStatus;
  order.statusHistory.push({ status: nextStatus, at: new Date(), by: actor.id as never, note });
  await order.save();

  return serializeOrder(order, { includeCustomer: true });
}
