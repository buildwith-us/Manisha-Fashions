import { KvEntry } from '../models/kvEntry.model';
import { logger } from './logger';

/**
 * Key-value store for password-reset and email-code quotas, attempt counters
 * and lockouts (PRD 2 / 8.11).
 *
 * Backed by MongoDB (the `kventries` collection), so this state survives a
 * restart or an idle spin-down and is shared by every instance: a lockout
 * cannot be escaped by waiting for a deploy, or by landing on another
 * instance. Rate-limit windows live in their own collection — see
 * middleware/rateLimiter.ts.
 */
export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<void>;
  incr(key: string): Promise<number>;
  expire(key: string, ttlSeconds: number): Promise<void>;
  ttl(key: string): Promise<number>;
}

/** A row counts only while unexpired; the TTL reaper is merely cleanup. */
const live = (now: Date) => ({ $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] });

class MongoStore implements KeyValueStore {
  async get(key: string) {
    const entry = await KvEntry.findOne({ _id: key, ...live(new Date()) }).lean();
    return entry?.value ?? null;
  }

  async set(key: string, value: string, ttlSeconds?: number) {
    const expiresAt = ttlSeconds ? new Date(Date.now() + ttlSeconds * 1000) : null;
    await KvEntry.updateOne({ _id: key }, { $set: { value, expiresAt } }, { upsert: true });
  }

  async del(key: string) {
    await KvEntry.deleteOne({ _id: key });
  }

  /**
   * Atomic in one round trip: an expired row restarts from 1 (and loses its
   * expiry), a live one is incremented and keeps its expiry, a missing one is
   * created at 1 — exactly the Redis INCR semantics the callers expect.
   */
  async incr(key: string) {
    const now = new Date();
    const expired = {
      $and: [{ $eq: [{ $type: '$expiresAt' }, 'date'] }, { $lte: ['$expiresAt', now] }],
    };
    const entry = await KvEntry.findOneAndUpdate(
      { _id: key },
      [
        {
          $set: {
            value: {
              $toString: {
                $add: [{ $cond: [expired, 0, { $toInt: { $ifNull: ['$value', '0'] } }] }, 1],
              },
            },
            expiresAt: { $cond: [expired, null, { $ifNull: ['$expiresAt', null] }] },
          },
        },
      ],
      { upsert: true, new: true },
    ).lean();
    return Number(entry?.value ?? 1);
  }

  async expire(key: string, ttlSeconds: number) {
    await KvEntry.updateOne({ _id: key }, { $set: { expiresAt: new Date(Date.now() + ttlSeconds * 1000) } });
  }

  async ttl(key: string) {
    const entry = await KvEntry.findOne({ _id: key, ...live(new Date()) }).lean();
    if (!entry || !entry.expiresAt) return -1;
    return Math.max(0, Math.ceil((entry.expiresAt.getTime() - Date.now()) / 1000));
  }
}

let store: KeyValueStore | null = null;

export function initStore(): KeyValueStore {
  if (store) return store;
  logger.info('Key-value store: MongoDB (quotas and lockouts survive restarts).');
  store = new MongoStore();
  return store;
}

export function getStore(): KeyValueStore {
  return store ?? initStore();
}

export async function disconnectStore(): Promise<void> {
  store = null;
}
