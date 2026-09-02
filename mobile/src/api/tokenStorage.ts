import * as SecureStore from 'expo-secure-store';

/**
 * PRD 8.10 — access and refresh tokens live in expo-secure-store (Keychain on
 * iOS, Keystore on Android). Never AsyncStorage, never plain app state.
 *
 * An in-memory mirror is kept so the Axios request interceptor stays
 * synchronous; SecureStore remains the source of truth across app launches.
 */

const ACCESS_TOKEN_KEY = 'manisha.accessToken';
const REFRESH_TOKEN_KEY = 'manisha.refreshToken';

let accessTokenCache: string | null = null;
let refreshTokenCache: string | null = null;

export async function loadTokens(): Promise<{ accessToken: string | null; refreshToken: string | null }> {
  const [accessToken, refreshToken] = await Promise.all([
    SecureStore.getItemAsync(ACCESS_TOKEN_KEY),
    SecureStore.getItemAsync(REFRESH_TOKEN_KEY),
  ]);
  accessTokenCache = accessToken;
  refreshTokenCache = refreshToken;
  return { accessToken, refreshToken };
}

export async function saveTokens(accessToken: string, refreshToken: string): Promise<void> {
  accessTokenCache = accessToken;
  refreshTokenCache = refreshToken;
  await Promise.all([
    SecureStore.setItemAsync(ACCESS_TOKEN_KEY, accessToken),
    SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refreshToken),
  ]);
}

export async function clearTokens(): Promise<void> {
  accessTokenCache = null;
  refreshTokenCache = null;
  await Promise.all([
    SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY),
    SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),
  ]);
}

export function getAccessToken(): string | null {
  return accessTokenCache;
}

export function getRefreshToken(): string | null {
  return refreshTokenCache;
}

/**
 * Decodes the JWT payload without verifying it. Verification is the server's
 * job — this only answers "is it worth sending, or should we refresh first?"
 * (PRD 8.10 app-start check).
 */
export function isTokenExpired(token: string, skewSeconds = 30): boolean {
  try {
    const [, payloadSegment] = token.split('.');
    if (!payloadSegment) return true;

    const normalized = payloadSegment.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
    const payload = JSON.parse(globalThis.atob(padded)) as { exp?: number };

    if (!payload.exp) return true;
    return payload.exp * 1000 <= Date.now() + skewSeconds * 1000;
  } catch {
    return true;
  }
}
