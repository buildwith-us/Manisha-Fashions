import type { AccountType, WholesaleStatus } from '../types';

/**
 * PRD 8.9 — Role & Permission Matrix.
 *
 * The PRD splits the combined "Admin/Staff" role from Section 3 into two
 * levels so day-to-day order/product updates don't require full admin rights.
 * Staff explicitly cannot: approve wholesale accounts, change pricing, or
 * manage staff/admin accounts.
 */
export const PERMISSIONS = {
  CATALOG_BROWSE: 'catalog:browse',
  WHOLESALE_PRICING_VIEW: 'pricing:wholesale:view',

  CART_MANAGE: 'cart:manage',
  ORDER_CREATE: 'order:create',
  ORDER_READ_OWN: 'order:read:own',
  ORDER_CANCEL_OWN: 'order:cancel:own',
  WISHLIST_MANAGE: 'wishlist:manage',

  PRODUCT_MANAGE: 'product:manage',
  PRODUCT_PRICE_MANAGE: 'product:price:manage',
  CATEGORY_MANAGE: 'category:manage',

  ORDER_READ_ALL: 'order:read:all',
  ORDER_STATUS_UPDATE: 'order:status:update',

  WHOLESALE_APPROVE: 'wholesale:approve',
  USER_MANAGE: 'user:manage',
  DASHBOARD_VIEW: 'dashboard:view',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

const CUSTOMER_PERMISSIONS: Permission[] = [
  PERMISSIONS.CATALOG_BROWSE,
  PERMISSIONS.CART_MANAGE,
  PERMISSIONS.ORDER_CREATE,
  PERMISSIONS.ORDER_READ_OWN,
  PERMISSIONS.ORDER_CANCEL_OWN,
  PERMISSIONS.WISHLIST_MANAGE,
];

const STAFF_PERMISSIONS: Permission[] = [
  PERMISSIONS.CATALOG_BROWSE,
  PERMISSIONS.WHOLESALE_PRICING_VIEW,
  PERMISSIONS.PRODUCT_MANAGE,
  PERMISSIONS.CATEGORY_MANAGE,
  PERMISSIONS.ORDER_READ_ALL,
  PERMISSIONS.ORDER_STATUS_UPDATE,
  PERMISSIONS.DASHBOARD_VIEW,
];

const ADMIN_PERMISSIONS: Permission[] = [
  ...STAFF_PERMISSIONS,
  PERMISSIONS.PRODUCT_PRICE_MANAGE,
  PERMISSIONS.WHOLESALE_APPROVE,
  PERMISSIONS.USER_MANAGE,
  PERMISSIONS.ORDER_READ_OWN,
  PERMISSIONS.CART_MANAGE,
  PERMISSIONS.ORDER_CREATE,
];

/**
 * Resolves the effective permission set for a user.
 *
 * A wholesale buyer whose application is still pending or was rejected gets an
 * empty set — PRD 4.1 blocks them from browsing and ordering entirely, so they
 * can log in and see their status and nothing else.
 */
export function resolvePermissions(
  accountType: AccountType,
  wholesaleStatus: WholesaleStatus,
): string[] {
  switch (accountType) {
    case 'admin':
      return [...new Set(ADMIN_PERMISSIONS)];
    case 'staff':
      return [...STAFF_PERMISSIONS];
    case 'wholesale':
      if (wholesaleStatus !== 'approved') return [];
      return [...CUSTOMER_PERMISSIONS, PERMISSIONS.WHOLESALE_PRICING_VIEW];
    case 'retail':
    default:
      return [...CUSTOMER_PERMISSIONS];
  }
}

/**
 * Single source of truth for whether wholesale pricing may be exposed.
 * Used by the product serializer (PRD 8.4 — wholesalePrice is stripped
 * server-side, never merely hidden by the client).
 */
export function canSeeWholesalePricing(
  accountType: AccountType | null | undefined,
  wholesaleStatus: WholesaleStatus | null | undefined,
): boolean {
  if (accountType === 'admin' || accountType === 'staff') return true;
  return accountType === 'wholesale' && wholesaleStatus === 'approved';
}

export function isStaffRole(accountType: AccountType): boolean {
  return accountType === 'admin' || accountType === 'staff';
}

/* ── Storefront visibility (PRD 4.2 / 4.7) ──────────────────────────────── */

export type Storefront = 'retail' | 'wholesale' | 'all';
export type ProductVisibility = 'both' | 'retail' | 'wholesale';

type Viewer = { accountType: AccountType; wholesaleStatus: WholesaleStatus };

/**
 * Which storefront a viewer browses.
 *
 * Staff and admin get 'all' so the management list still shows every product
 * whatever its visibility. A pending or rejected wholesale applicant is not an
 * approved buyer, so they see the retail storefront — as does a guest.
 */
export function storefrontFor(viewer?: Viewer | null): Storefront {
  if (viewer?.accountType === 'admin' || viewer?.accountType === 'staff') return 'all';
  return viewer?.accountType === 'wholesale' && viewer.wholesaleStatus === 'approved'
    ? 'wholesale'
    : 'retail';
}

/**
 * Whether a product may be shown to — or bought by — this viewer.
 *
 * The catalogue query already filters on visibility, but that only covers
 * browsing. Anything that takes a product id straight from the client (product
 * detail, add to cart, Buy now, checkout) has to ask this too, or a retail
 * customer who knows the id of a wholesale-only piece could put it in a cart
 * and be charged the retail price for it.
 */
export function isProductVisibleTo(
  visibility: ProductVisibility | undefined,
  viewer?: Viewer | null,
): boolean {
  const storefront = storefrontFor(viewer);
  if (storefront === 'all') return true;
  const effective = visibility ?? 'both';
  return effective === 'both' || effective === storefront;
}
