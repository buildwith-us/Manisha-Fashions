import crypto from 'crypto';
import { env, razorpayConfigured } from '../config/env';
import { getRazorpay } from '../config/razorpay';
import { logger } from '../config/logger';
import { ApiError } from '../utils/ApiError';

/**
 * PRD 4.4 / 8.4 — Razorpay for UPI, cards, netbanking and wallets. COD skips
 * the gateway entirely and adds a flat shipping charge instead.
 */

export interface RazorpayOrderHandle {
  razorpayOrderId: string;
  amount: number;
  currency: string;
  keyId: string;
}

export async function createRazorpayOrder(
  amountInPaise: number,
  receipt: string,
): Promise<RazorpayOrderHandle> {
  const razorpay = getRazorpay();
  if (!razorpay || !razorpayConfigured) {
    throw ApiError.serviceUnavailable(
      'Online payment is not available right now. Please choose Cash on Delivery.',
    );
  }

  const order = await razorpay.orders.create({
    amount: amountInPaise,
    currency: env.CURRENCY,
    receipt,
    payment_capture: true,
  });

  return {
    razorpayOrderId: order.id,
    amount: Number(order.amount),
    currency: order.currency,
    keyId: env.RAZORPAY_KEY_ID as string,
  };
}

/**
 * Verifies the checkout handshake signature.
 * The client cannot forge this: it is an HMAC over order_id|payment_id keyed
 * with the secret, which never leaves the server.
 */
export function verifyPaymentSignature(input: {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
}): boolean {
  if (!env.RAZORPAY_KEY_SECRET) return false;

  const expected = crypto
    .createHmac('sha256', env.RAZORPAY_KEY_SECRET)
    .update(`${input.razorpayOrderId}|${input.razorpayPaymentId}`)
    .digest('hex');

  return timingSafeEqual(expected, input.razorpaySignature);
}

/** PRD 4.4 — webhook signature check, computed over the raw request body. */
export function verifyWebhookSignature(rawBody: Buffer | string, signature: string): boolean {
  if (!env.RAZORPAY_WEBHOOK_SECRET) {
    logger.warn('RAZORPAY_WEBHOOK_SECRET not set — rejecting webhook.');
    return false;
  }

  const expected = crypto
    .createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');

  return timingSafeEqual(expected, signature);
}

function timingSafeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');
  if (bufferA.length !== bufferB.length) return false;
  return crypto.timingSafeEqual(bufferA, bufferB);
}

/** COD adds a flat shipping charge; prepaid orders ship free (PRD 4.4). */
export function shippingChargeFor(paymentMethod: 'razorpay' | 'cod'): number {
  return paymentMethod === 'cod' ? env.COD_SHIPPING_CHARGE : env.PREPAID_SHIPPING_CHARGE;
}
