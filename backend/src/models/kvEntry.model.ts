import { Schema, model } from 'mongoose';

/**
 * Short-lived counters and flags for config/store.ts: password-reset and
 * email-code quotas, attempt counts and lockouts. In MongoDB so they survive a
 * restart and are shared by every instance.
 *
 * `expiresAt` null means "no expiry". The TTL index only reaps expired rows
 * eventually (about once a minute); the store itself treats an expired row as
 * absent on read, so correctness never waits for the reaper.
 */
export interface IKvEntry {
  _id: string;
  value: string;
  expiresAt: Date | null;
}

const kvEntrySchema = new Schema<IKvEntry>(
  {
    _id: { type: String, required: true },
    value: { type: String, required: true },
    expiresAt: { type: Date, default: null },
  },
  { versionKey: false, collection: 'kventries' },
);

kvEntrySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const KvEntry = model<IKvEntry>('KvEntry', kvEntrySchema);
