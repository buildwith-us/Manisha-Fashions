import { Schema, model } from 'mongoose';

/**
 * One fixed rate-limit window per client key (see middleware/rateLimiter.ts).
 * Kept in MongoDB so auth and write limits hold across restarts and instances.
 * The TTL index cleans up finished windows; the counting logic does not rely
 * on it (an elapsed window is restarted on the next hit).
 */
export interface IRateLimitHit {
  _id: string;
  count: number;
  resetAt: Date;
}

const rateLimitHitSchema = new Schema<IRateLimitHit>(
  {
    _id: { type: String, required: true },
    count: { type: Number, required: true },
    resetAt: { type: Date, required: true },
  },
  { versionKey: false, collection: 'ratelimits' },
);

rateLimitHitSchema.index({ resetAt: 1 }, { expireAfterSeconds: 0 });

export const RateLimitHit = model<IRateLimitHit>('RateLimitHit', rateLimitHitSchema);
