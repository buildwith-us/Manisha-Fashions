// ⚠️ TEMPORARY DEV AUTH — REMOVE BEFORE PRODUCTION
//
// Stubs OTP verification so flows can be exercised while MSG91 is not wired up.
// Everything in this file is unreachable when DEV_AUTH_BYPASS is false, and the
// whole feature is removed by deleting this file plus the single guarded block
// in authSlice.verifyOtp that calls into it.
//
// This does NOT modify the real verification path. When no rule below matches,
// the thunk falls through to the live API exactly as it does in production.

import type { User } from '../api/types';

/**
 * The one switch.
 *
 * Defaults to `__DEV__`, so a production bundle can never reach the bypass —
 * nothing needs to be remembered at release time.
 *
 * The env override exists only so a *standalone test APK* can be built with the
 * bypass on (a release bundle has `__DEV__ === false`, which would otherwise
 * make the bypass untestable outside Metro). It is opt-in and off unless
 * explicitly set at build time:
 *
 *   EXPO_PUBLIC_DEV_AUTH_BYPASS=true ./gradlew assembleRelease   # testable
 *   ./gradlew assembleRelease                                    # normal auth
 *
 * Never set it for a build you intend to ship.
 */
export const DEV_AUTH_BYPASS =
  __DEV__ || process.env.EXPO_PUBLIC_DEV_AUTH_BYPASS === 'true';

/** Accepted for any phone number except the hardcoded admin below. */
const DEV_DEFAULT_OTP = '1234';

/** This pair logs in as admin, and rejects the default code. */
const DEV_ADMIN_PHONE = '1234567890';
const DEV_ADMIN_OTP = '4321';

/**
 * Mirrors the backend RBAC matrix (backend/src/utils/rbac.ts) so role routing,
 * `usePermission` and every screen guard behave exactly as they do against the
 * real API.
 */
const RETAIL_PERMISSIONS = [
  'catalog:browse',
  'cart:manage',
  'order:create',
  'order:read:own',
  'order:cancel:own',
  'wishlist:manage',
];

const ADMIN_PERMISSIONS = [
  'catalog:browse',
  'pricing:wholesale:view',
  'product:manage',
  'category:manage',
  'order:read:all',
  'order:status:update',
  'dashboard:view',
  'product:price:manage',
  'wholesale:approve',
  'user:manage',
  'order:read:own',
  'cart:manage',
  'order:create',
];

function base64Url(value: string): string {
  return globalThis
    .btoa(value)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * A structurally valid JWT with a real `exp`, so `isTokenExpired` and the
 * refresh-on-401 path treat it the way they treat a live token. The signature
 * is nonsense — the server would reject it, which is the point: this is for
 * exercising client flows, not for talking to a real backend.
 */
function fakeAccessToken(userId: string, accountType: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64Url(
    JSON.stringify({
      sub: userId,
      accountType,
      wholesaleStatus: accountType === 'retail' ? 'none' : 'none',
      tokenType: 'access',
      iat: now,
      exp: now + 60 * 60 * 24 * 30,
      iss: 'manisha-fashions-dev-bypass',
    }),
  );
  return `${header}.${payload}.dev-bypass-not-a-real-signature`;
}

export interface DevSession {
  user: User;
  accessToken: string;
  refreshToken: string;
}

/**
 * The hardcoded admin number starts with a 1, which the login screen's Indian
 * mobile check (`/^[6-9]/`) rejects — so without this the admin bypass could
 * never be reached through the UI. Only ever true while the flag is on.
 */
export function isDevAuthPhone(phone: string): boolean {
  if (!DEV_AUTH_BYPASS) return false;
  return phone.replace(/\D/g, '').slice(-10) === DEV_ADMIN_PHONE;
}

/**
 * The code this phone will accept while the bypass is on, surfaced on the OTP
 * screen so there is no guessing. Returned only when the flag is on.
 */
export function devOtpHintFor(phone: string): string | null {
  if (!DEV_AUTH_BYPASS) return null;
  const digits = phone.replace(/\D/g, '').slice(-10);
  return digits === DEV_ADMIN_PHONE ? DEV_ADMIN_OTP : DEV_DEFAULT_OTP;
}

/**
 * Returns a well-formed fake session when the phone/code pair matches a dev
 * rule, or `null` to let the caller run the real verification.
 */
export function resolveDevSession(phone: string, code: string): DevSession | null {
  if (!DEV_AUTH_BYPASS) return null;

  const digits = phone.replace(/\D/g, '').slice(-10);
  const isAdminPhone = digits === DEV_ADMIN_PHONE;

  // The admin number takes only its own code — the default is not accepted.
  if (isAdminPhone && code !== DEV_ADMIN_OTP) return null;
  if (!isAdminPhone && code !== DEV_DEFAULT_OTP) return null;

  const accountType = isAdminPhone ? 'admin' : 'retail';
  const userId = `dev-${digits}`;

  const user: User = {
    id: userId,
    phone: `+91${digits}`,
    name: isAdminPhone ? 'Dev Admin' : undefined,
    accountType: accountType as User['accountType'],
    // Unknown numbers resolve to retail; no wholesale application exists, so
    // the pending/rejected blocking rule is untouched by this bypass.
    wholesaleStatus: 'none',
    permissions: isAdminPhone ? ADMIN_PERMISSIONS : RETAIL_PERMISSIONS,
    addresses: [],
    createdAt: new Date().toISOString(),
  };

  return {
    user,
    accessToken: fakeAccessToken(userId, accountType),
    refreshToken: fakeAccessToken(userId, accountType),
  };
}
