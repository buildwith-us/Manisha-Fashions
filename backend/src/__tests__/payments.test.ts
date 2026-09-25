import crypto from 'crypto';
import {
  api,
  clearTestDb,
  connectTestDb,
  createTestProduct,
  createTestUser,
  disconnectTestDb,
  request,
  seedCart,
} from './helpers/testServer';
import { Order } from '../models/order.model';
import { Product } from '../models/product.model';
import { expireStalePendingOrders } from '../services/order.service';

/**
 * Online payments end to end, against a mockRazorpay Razorpay (never the real API):
 * F3 refunds on cancelled paid orders, F11 webhook processed before it is
 * acknowledged, F12 unpaid orders expiring and late captures refunded.
 */

const KEY_SECRET = 'test_key_secret';
const WEBHOOK_SECRET = 'test_webhook_secret';

jest.mock('../config/env', () => {
  const actual = jest.requireActual('../config/env');
  return {
    ...actual,
    razorpayConfigured: true,
    env: {
      ...actual.env,
      RAZORPAY_KEY_ID: 'rzp_test_payments_suite',
      RAZORPAY_KEY_SECRET: 'test_key_secret',
      RAZORPAY_WEBHOOK_SECRET: 'test_webhook_secret',
    },
  };
});

const mockRazorpay = {
  orderSeq: 0,
  refundSeq: 0,
  captured: new Map<string, string>(),
  refunds: [] as Array<{ id: string; payment_id: string; amount: number; status: string; notes: Record<string, string> }>,
  refundCalls: 0,
  failNextRefund: false,
  /** Razorpay accepted the refund but the response never arrived. */
  loseNextRefundResponse: false,
};

jest.mock('../config/razorpay', () => ({
  razorpayConfigured: true,
  getRazorpay: () => ({
    orders: {
      create: async (input: { amount: number; currency: string }) => {
        mockRazorpay.orderSeq += 1;
        return { id: `order_fake_${mockRazorpay.orderSeq}`, amount: input.amount, currency: input.currency };
      },
      fetchPayments: async (orderId: string) => ({
        items: mockRazorpay.captured.has(orderId) ? [{ id: mockRazorpay.captured.get(orderId), status: 'captured' }] : [],
      }),
      all: async () => ({ items: [] }),
    },
    payments: {
      refund: async (paymentId: string, params: { amount: number; notes: Record<string, string> }) => {
        mockRazorpay.refundCalls += 1;
        if (mockRazorpay.failNextRefund) {
          mockRazorpay.failNextRefund = false;
          throw new Error('Razorpay: The API is temporarily unavailable');
        }
        mockRazorpay.refundSeq += 1;
        const refund = { id: `rfnd_fake_${mockRazorpay.refundSeq}`, payment_id: paymentId, amount: params.amount, status: 'pending', notes: params.notes };
        mockRazorpay.refunds.push(refund);
        if (mockRazorpay.loseNextRefundResponse) {
          mockRazorpay.loseNextRefundResponse = false;
          throw new Error('socket hang up');
        }
        return refund;
      },
      fetchMultipleRefund: async (paymentId: string) => ({
        items: mockRazorpay.refunds.filter((refund) => refund.payment_id === paymentId),
      }),
    },
  }),
}));

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
afterEach(async () => {
  Object.assign(mockRazorpay, { captured: new Map(), refunds: [], refundCalls: 0, failNextRefund: false, loseNextRefundResponse: false });
  jest.restoreAllMocks();
  await clearTestDb();
});

const PRICE = 50_000;

function sign(orderId: string, paymentId: string) {
  return crypto.createHmac('sha256', KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex');
}

function webhook(event: Record<string, unknown>) {
  const body = JSON.stringify(event);
  const signature = crypto.createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');
  return request
    .post(api('/webhooks/razorpay'))
    .set('Content-Type', 'application/json')
    .set('X-Razorpay-Signature', signature)
    .send(body);
}

async function placeOnlineOrder() {
  const customer = await createTestUser({ address: { state: 'Kerala' } });
  const product = await createTestProduct({ retailPrice: PRICE, stock: 5 });
  await seedCart(customer.id, product.id, 2);
  const res = await request
    .post(api('/orders/checkout'))
    .set('Authorization', customer.auth)
    .send({ addressId: customer.addressId, paymentMethod: 'razorpay' })
    .expect(201);
  return { customer, product, order: res.body.data.order, rzOrderId: res.body.data.payment.razorpayOrderId as string };
}

async function placePaidOrder() {
  const placed = await placeOnlineOrder();
  const paymentId = `pay_fake_${placed.order.orderNumber}`;
  const confirmed = await request
    .post(api('/orders/payment/confirm'))
    .set('Authorization', placed.customer.auth)
    .send({ orderId: placed.order.id, razorpayPaymentId: paymentId, razorpaySignature: sign(placed.rzOrderId, paymentId) })
    .expect(200);
  expect(confirmed.body.data.paymentStatus).toBe('paid');
  return { ...placed, paymentId };
}

const stockOf = async (productId: string) => (await Product.findById(productId))?.stock;

describe('F3: a paid order is cancelled only with a refund', () => {
  it("turns the customer's cancel into a cancellation request and leaves the order alone", async () => {
    const { customer, order, product } = await placePaidOrder();

    const res = await request
      .post(api(`/orders/${order.id}/cancel`))
      .set('Authorization', customer.auth)
      .send({ reason: 'Ordered the wrong size' })
      .expect(200);

    expect(res.body.data).toMatchObject({
      orderStatus: 'placed',
      paymentStatus: 'paid',
      cancellable: false,
      cancellationRequestable: false,
      cancellationRequest: { reason: 'Ordered the wrong size' },
      refundState: 'none',
    });
    expect(await stockOf(product.id)).toBe(3);
    expect(mockRazorpay.refundCalls).toBe(0);
  });

  it('refuses staff, and refunds the full amount when admin cancels', async () => {
    const { order, product, paymentId } = await placePaidOrder();
    const staff = await createTestUser({ accountType: 'staff' });
    const admin = await createTestUser({ accountType: 'admin' });

    await request
      .patch(api(`/admin/orders/${order.id}/status`))
      .set('Authorization', staff.auth)
      .send({ status: 'cancelled' })
      .expect(403);

    const res = await request
      .patch(api(`/admin/orders/${order.id}/status`))
      .set('Authorization', admin.auth)
      .send({ status: 'cancelled', note: 'Out of stock' })
      .expect(200);

    expect(res.body.data).toMatchObject({ orderStatus: 'cancelled', paymentStatus: 'paid', refundState: 'pending' });
    expect(mockRazorpay.refunds).toEqual([
      expect.objectContaining({ payment_id: paymentId, amount: order.totalAmount, notes: { orderNumber: order.orderNumber } }),
    ]);
    expect(await stockOf(product.id)).toBe(5);
  });

  it('marks the order refunded when Razorpay reports refund.processed, and ignores a replay', async () => {
    const { order } = await placePaidOrder();
    const admin = await createTestUser({ accountType: 'admin' });
    await request.patch(api(`/admin/orders/${order.id}/status`)).set('Authorization', admin.auth).send({ status: 'cancelled' });

    const refund = mockRazorpay.refunds[0];
    const event = { event: 'refund.processed', payload: { refund: { entity: { ...refund, status: 'processed' } } } };
    await webhook(event).expect(200);
    await webhook(event).expect(200);

    const saved = await Order.findById(order.id);
    expect(saved?.paymentStatus).toBe('refunded');
    expect(saved?.refund).toMatchObject({ status: 'processed', razorpayRefundId: refund.id });
    expect(mockRazorpay.refundCalls).toBe(1);
  });

  it('records a failed refund and lets admin retry it', async () => {
    const { order } = await placePaidOrder();
    const admin = await createTestUser({ accountType: 'admin' });
    mockRazorpay.failNextRefund = true;

    const cancelled = await request
      .patch(api(`/admin/orders/${order.id}/status`))
      .set('Authorization', admin.auth)
      .send({ status: 'cancelled' })
      .expect(200);
    expect(cancelled.body.data.refundState).toBe('failed');
    expect(cancelled.body.data.refund.failureReason).toMatch(/temporarily unavailable/);

    const retried = await request
      .post(api(`/admin/orders/${order.id}/refund`))
      .set('Authorization', admin.auth)
      .expect(200);
    expect(retried.body.data.refundState).toBe('pending');
    expect(mockRazorpay.refunds).toHaveLength(1);
  });

  it('adopts a refund whose response was lost instead of refunding twice', async () => {
    const { order } = await placePaidOrder();
    const admin = await createTestUser({ accountType: 'admin' });
    mockRazorpay.loseNextRefundResponse = true;

    const cancelled = await request
      .patch(api(`/admin/orders/${order.id}/status`))
      .set('Authorization', admin.auth)
      .send({ status: 'cancelled' });
    expect(cancelled.body.data.refundState).toBe('failed');
    expect(mockRazorpay.refunds).toHaveLength(1);

    const retried = await request.post(api(`/admin/orders/${order.id}/refund`)).set('Authorization', admin.auth).expect(200);

    expect(retried.body.data.refundState).toBe('pending');
    expect(mockRazorpay.refunds).toHaveLength(1);
    expect(mockRazorpay.refundCalls).toBe(1);
  });

  it('sends one refund when two retries race', async () => {
    const { order } = await placePaidOrder();
    const admin = await createTestUser({ accountType: 'admin' });
    mockRazorpay.failNextRefund = true;
    await request.patch(api(`/admin/orders/${order.id}/status`)).set('Authorization', admin.auth).send({ status: 'cancelled' });

    await Promise.all([
      request.post(api(`/admin/orders/${order.id}/refund`)).set('Authorization', admin.auth),
      request.post(api(`/admin/orders/${order.id}/refund`)).set('Authorization', admin.auth),
    ]);

    expect(mockRazorpay.refunds).toHaveLength(1);
  });

  it('refuses a refund for staff and for orders that are not cancelled-and-paid', async () => {
    const { order } = await placePaidOrder();
    const staff = await createTestUser({ accountType: 'staff' });
    const admin = await createTestUser({ accountType: 'admin' });

    await request.post(api(`/admin/orders/${order.id}/refund`)).set('Authorization', staff.auth).expect(403);
    await request.post(api(`/admin/orders/${order.id}/refund`)).set('Authorization', admin.auth).expect(409);
    expect(mockRazorpay.refundCalls).toBe(0);
  });

  it('still lets a customer cancel an unpaid online order outright', async () => {
    const { customer, order, product } = await placeOnlineOrder();

    const res = await request
      .post(api(`/orders/${order.id}/cancel`))
      .set('Authorization', customer.auth)
      .send({})
      .expect(200);

    expect(res.body.data.orderStatus).toBe('cancelled');
    expect(await stockOf(product.id)).toBe(5);
  });
});

describe('F11: the webhook is processed before it is acknowledged', () => {
  it('answers 500 when processing fails, so Razorpay retries, then 200 once it succeeds', async () => {
    const { order, rzOrderId } = await placeOnlineOrder();
    const event = {
      event: 'payment.captured',
      payload: { payment: { entity: { id: 'pay_fake_retry', order_id: rzOrderId } } },
    };

    jest.spyOn(Order, 'findOne').mockRejectedValueOnce(new Error('database unavailable'));
    await webhook(event).expect(500);
    expect((await Order.findById(order.id))?.paymentStatus).toBe('pending');

    await webhook(event).expect(200);
    await webhook(event).expect(200);
    expect((await Order.findById(order.id))?.paymentStatus).toBe('paid');
  });

  it('rejects a bad signature without touching the order', async () => {
    const { order, rzOrderId } = await placeOnlineOrder();
    await request
      .post(api('/webhooks/razorpay'))
      .set('X-Razorpay-Signature', 'not-a-signature')
      .send({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_x', order_id: rzOrderId } } } })
      .expect(401);
    expect((await Order.findById(order.id))?.paymentStatus).toBe('pending');
  });
});

describe('F12: unpaid online orders expire and release their stock', () => {
  const minutesFromNow = (minutes: number) => new Date(Date.now() + minutes * 60_000);

  it('expires only orders past the window, once, and restocks once', async () => {
    const { order, product } = await placeOnlineOrder();
    expect(await stockOf(product.id)).toBe(3);

    expect(await expireStalePendingOrders(minutesFromNow(10))).toEqual({ expired: 0, paid: 0 });

    const first = await expireStalePendingOrders(minutesFromNow(31));
    const second = await expireStalePendingOrders(minutesFromNow(45));

    expect(first.expired).toBe(1);
    expect(second.expired).toBe(0);
    const saved = await Order.findById(order.id);
    expect(saved).toMatchObject({ paymentStatus: 'expired', orderStatus: 'cancelled' });
    expect(await stockOf(product.id)).toBe(5);
  });

  it('marks the order paid instead when Razorpay already captured the payment', async () => {
    const { order, rzOrderId, product } = await placeOnlineOrder();
    mockRazorpay.captured.set(rzOrderId, 'pay_fake_captured');

    expect(await expireStalePendingOrders(minutesFromNow(31))).toEqual({ expired: 0, paid: 1 });

    const saved = await Order.findById(order.id);
    expect(saved).toMatchObject({ paymentStatus: 'paid', orderStatus: 'placed' });
    expect(await stockOf(product.id)).toBe(3);
  });

  it('refunds a capture that arrives by webhook after expiry, flagged for admin', async () => {
    const { order, rzOrderId } = await placeOnlineOrder();
    await expireStalePendingOrders(minutesFromNow(31));

    await webhook({
      event: 'payment.captured',
      payload: { payment: { entity: { id: 'pay_fake_late', order_id: rzOrderId } } },
    }).expect(200);

    const saved = await Order.findById(order.id);
    expect(saved?.paymentStatus).toBe('paid');
    expect(saved?.payment?.lateCapture).toBe(true);
    expect(saved?.refund?.status).toBe('pending');
    expect(mockRazorpay.refunds).toEqual([expect.objectContaining({ payment_id: 'pay_fake_late', amount: order.totalAmount })]);
  });

  it('refunds a capture confirmed by the app after expiry, and tells the customer', async () => {
    const { customer, order, rzOrderId } = await placeOnlineOrder();
    await expireStalePendingOrders(minutesFromNow(31));

    const res = await request
      .post(api('/orders/payment/confirm'))
      .set('Authorization', customer.auth)
      .send({ orderId: order.id, razorpayPaymentId: 'pay_fake_app', razorpaySignature: sign(rzOrderId, 'pay_fake_app') });

    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/being refunded/);
    expect(mockRazorpay.refunds).toHaveLength(1);
  });
});
