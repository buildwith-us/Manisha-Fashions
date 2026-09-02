import { Schema, model, type Document, type Types } from 'mongoose';

/**
 * PRD 8.7 — the refresh token is stored hashed, against the user + device.
 *
 * Refresh tokens are high-entropy random values, so a SHA-256 hash is both
 * safe and indexable (unlike bcrypt, which cannot be looked up by value).
 * Logout revokes the row server-side immediately (PRD 8.10).
 */
export interface IRefreshToken extends Document<Types.ObjectId> {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  jti: string;
  tokenHash: string;
  deviceId?: string;
  userAgent?: string;
  expiresAt: Date;
  revokedAt?: Date;
  createdAt: Date;
}

const refreshTokenSchema = new Schema<IRefreshToken>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    jti: { type: String, required: true, unique: true },
    tokenHash: { type: String, required: true, index: true },
    deviceId: { type: String },
    userAgent: { type: String },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// Mongo reaps expired sessions automatically; nothing to clean up by hand.
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const RefreshToken = model<IRefreshToken>('RefreshToken', refreshTokenSchema);
