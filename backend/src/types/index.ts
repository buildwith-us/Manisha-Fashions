/**
 * Shared domain types.
 *
 * MONEY: every monetary value in this codebase is an integer number of paise
 * (₹1 = 100). Floats are never used for money.
 */

export const ACCOUNT_TYPES = ['retail', 'wholesale', 'staff', 'admin'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const WHOLESALE_STATUSES = ['none', 'pending', 'approved', 'rejected'] as const;
export type WholesaleStatus = (typeof WHOLESALE_STATUSES)[number];

export const ORDER_STATUSES = [
  'placed',
  'processing',
  'shipped',
  'delivered',
  'cancelled',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const PAYMENT_METHODS = ['razorpay', 'cod'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_STATUSES = ['pending', 'paid', 'failed', 'refunded'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** Valid forward transitions for the order lifecycle (PRD 4.5). */
export const ORDER_STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  placed: ['processing', 'cancelled'],
  processing: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: [],
  cancelled: [],
};

export interface JwtAccessPayload {
  sub: string;
  accountType: AccountType;
  wholesaleStatus: WholesaleStatus;
  tokenType: 'access';
}

export interface JwtRefreshPayload {
  sub: string;
  jti: string;
  tokenType: 'refresh';
}

export interface AuthenticatedUser {
  id: string;
  phone: string;
  accountType: AccountType;
  wholesaleStatus: WholesaleStatus;
  permissions: string[];
}
