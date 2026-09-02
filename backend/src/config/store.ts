import { logger } from './logger';

/**
 * Key-value store for OTP codes and rate-limit counters (PRD 2 / 8.11).
 *
 * Redis was removed from this project, so the store is in-process. Two
 * consequences worth knowing, because they are behavioural, not cosmetic:
 *
 *   1. State does not survive a restart. An OTP issued before a deploy or an
 *      idle spin-down will not verify afterwards — the user simply requests a
 *      new code.
 *   2. State is not shared between instances. This is correct for a single
 *      instance only; running two would give each its own OTP and rate-limit
 *      state, letting a client bypass limits by landing on the other one.
 *
 * If the service is ever scaled past one instance, this must go back to a
 * shared store. The `KeyValueStore` interface is the seam for that: implement
 * it against Redis (or similar) and return it from `initStore`, and no caller
 * changes.
 */
export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<void>;
  incr(key: string): Promise<number>;
  expire(key: string, ttlSeconds: number): Promise<void>;
  ttl(key: string): Promise<number>;
}

class MemoryStore implements KeyValueStore {
  private readonly entries = new Map<string, { value: string; expiresAt: number | null }>();

  private read(key: string): string | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return null;
    }
    return entry.value;
  }

  async get(key: string) {
    return this.read(key);
  }

  async set(key: string, value: string, ttlSeconds?: number) {
    this.entries.set(key, {
      value,
      expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null,
    });
  }

  async del(key: string) {
    this.entries.delete(key);
  }

  async incr(key: string) {
    const current = Number(this.read(key) ?? 0) + 1;
    const existing = this.entries.get(key);
    this.entries.set(key, { value: String(current), expiresAt: existing?.expiresAt ?? null });
    return current;
  }

  async expire(key: string, ttlSeconds: number) {
    const entry = this.entries.get(key);
    if (entry) entry.expiresAt = Date.now() + ttlSeconds * 1000;
  }

  async ttl(key: string) {
    const entry = this.entries.get(key);
    if (!entry || entry.expiresAt === null) return -1;
    return Math.max(0, Math.ceil((entry.expiresAt - Date.now()) / 1000));
  }
}

let store: KeyValueStore | null = null;

export function initStore(): KeyValueStore {
  if (store) return store;
  logger.info('Key-value store: in-process (OTP and rate-limit state reset on restart).');
  store = new MemoryStore();
  return store;
}

export function getStore(): KeyValueStore {
  return store ?? initStore();
}

export async function disconnectStore(): Promise<void> {
  store = null;
}
