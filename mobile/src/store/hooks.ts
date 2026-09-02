import { useDispatch, useSelector, type TypedUseSelectorHook } from 'react-redux';
import type { AppDispatch, RootState } from './index';

/** PRD 8.1 — typed hooks; screens never touch the untyped useSelector. */
export const useAppDispatch = () => useDispatch<AppDispatch>();
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;

/* ── Permission helpers, mirroring the backend's RBAC matrix (PRD 8.9) ──── */

export const PERMISSIONS = {
  CATALOG_BROWSE: 'catalog:browse',
  WHOLESALE_PRICING_VIEW: 'pricing:wholesale:view',
  CART_MANAGE: 'cart:manage',
  ORDER_CREATE: 'order:create',
  PRODUCT_MANAGE: 'product:manage',
  PRODUCT_PRICE_MANAGE: 'product:price:manage',
  CATEGORY_MANAGE: 'category:manage',
  ORDER_READ_ALL: 'order:read:all',
  ORDER_STATUS_UPDATE: 'order:status:update',
  WHOLESALE_APPROVE: 'wholesale:approve',
  USER_MANAGE: 'user:manage',
  DASHBOARD_VIEW: 'dashboard:view',
} as const;

export function usePermission(permission: string): boolean {
  return useAppSelector((state) => state.auth.user?.permissions.includes(permission) ?? false);
}

export function useIsStaff(): boolean {
  return useAppSelector((state) => {
    const type = state.auth.user?.accountType;
    return type === 'admin' || type === 'staff';
  });
}

/** True while a wholesale application is pending or was rejected (PRD 4.1). */
export function useIsWholesaleBlocked(): boolean {
  return useAppSelector((state) => {
    const user = state.auth.user;
    return user?.accountType === 'wholesale' && user.wholesaleStatus !== 'approved';
  });
}
