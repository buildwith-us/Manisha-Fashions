import { z } from 'zod';
import { ORDER_STATUSES } from '../types';
import { objectId, paginationQuery } from './common';

export const checkoutSchema = z.object({
  addressId: objectId,
  paymentMethod: z.enum(['razorpay', 'cod']),
  /**
   * "Buy now" — order this one product and leave the saved cart untouched.
   * Omitted for a normal cart checkout. The quantity ceiling matches the cart's
   * so the two routes to an order cannot disagree about what is orderable.
   */
  buyNow: z
    .object({
      productId: objectId,
      quantity: z.number().int().min(1).max(999),
    })
    .optional(),
});

export const confirmPaymentSchema = z.object({
  orderId: objectId,
  razorpayPaymentId: z.string().min(4),
  razorpaySignature: z.string().min(10),
});

export const cancelOrderSchema = z.object({
  reason: z.string().trim().max(300).optional(),
});

export const orderListQuery = paginationQuery.extend({
  status: z.enum(ORDER_STATUSES).optional(),
  search: z.string().trim().max(60).optional(),
});

export const updateOrderStatusSchema = z.object({
  status: z.enum(ORDER_STATUSES),
  note: z.string().trim().max(300).optional(),
});
