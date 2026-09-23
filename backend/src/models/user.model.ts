import { Schema, model, type Document, type Types } from 'mongoose';
import {
  ACCOUNT_TYPES,
  WHOLESALE_STATUSES,
  type AccountType,
  type WholesaleStatus,
} from '../types';

export interface IAddress {
  _id: Types.ObjectId;
  label: string;
  fullName: string;
  phone: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  pincode: string;
  isDefault: boolean;
}

export type AuthProvider = 'otp' | 'password' | 'google';

export interface IUser extends Document<Types.ObjectId> {
  _id: Types.ObjectId;
  /**
   * Optional since Google sign-in: Google returns email/name/sub and never a
   * phone number. OTP accounts still key on it, so the index is sparse-unique
   * rather than dropped — two accounts can be phone-less, never phone-equal.
   */
  phone?: string;
  name?: string;
  email?: string;
  /** Profile photo URL; only Google supplies one today. */
  avatar?: string;
  /**
   * bcrypt hash. Absent on accounts created by Google sign-in (and by
   * `make-admin`) until a password is set through the reset flow.
   * `select: false`, so it never rides along on an ordinary read.; `select: false`, so it never rides along on an ordinary read. */
  passwordHash?: string;
  /** Google's stable `sub` claim, not the email — the email can change. */
  googleId?: string;
  /** Every credential this account can sign in with; order is not meaningful. */
  authProviders: AuthProvider[];
  /** bcrypt hash of the emailed 6-digit code (low entropy → slow hash). */
  passwordResetOtpHash?: string;
  passwordResetOtpExpiresAt?: Date;
  /** SHA-256 of the short-lived token issued once the code is verified. */
  passwordResetTokenHash?: string;
  passwordResetTokenExpiresAt?: Date;
  accountType: AccountType;
  wholesaleStatus: WholesaleStatus;
  /** Wholesale application details — PRD 6 flags document upload as optional/TBC. */
  business?: {
    businessName?: string;
    gstNumber?: string;
    shopProofUrl?: string;
    appliedAt?: Date;
  };
  wholesaleReview?: {
    reviewedBy?: Types.ObjectId;
    reviewedAt?: Date;
    reason?: string;
  };
  addresses: Types.DocumentArray<IAddress>;
  isActive: boolean;
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const addressSchema = new Schema<IAddress>(
  {
    label: { type: String, default: 'Home', trim: true, maxlength: 40 },
    fullName: { type: String, required: true, trim: true, maxlength: 80 },
    phone: { type: String, required: true, trim: true },
    line1: { type: String, required: true, trim: true, maxlength: 200 },
    line2: { type: String, trim: true, maxlength: 200 },
    city: { type: String, required: true, trim: true, maxlength: 80 },
    state: { type: String, required: true, trim: true, maxlength: 80 },
    pincode: { type: String, required: true, trim: true, match: /^[1-9][0-9]{5}$/ },
    isDefault: { type: Boolean, default: false },
  },
  { _id: true },
);

const userSchema = new Schema<IUser>(
  {
    phone: {
      type: String,
      // Google accounts have none. `sparse` keeps uniqueness for the accounts
      // that do have one while allowing many documents to omit it entirely —
      // a plain unique index would collide on the second null.
      unique: true,
      sparse: true,
      trim: true,
      // Stored in E.164 (e.g. +919876543210) so lookups are unambiguous.
      match: /^\+[1-9]\d{7,14}$/,
    },
    name: { type: String, trim: true, maxlength: 80 },
    // Unique now that it is a login credential and the key Google links on.
    email: { type: String, trim: true, lowercase: true, maxlength: 160, unique: true, sparse: true },
    avatar: { type: String, trim: true, maxlength: 500 },
    passwordHash: { type: String, select: false },
    googleId: { type: String, unique: true, sparse: true },
    authProviders: {
      type: [String],
      enum: ['otp', 'password', 'google'],
      default: ['otp'],
    },
    // Only hashes are stored: a leaked database cannot be used to reset accounts.
    passwordResetOtpHash: { type: String, select: false },
    passwordResetOtpExpiresAt: { type: Date, select: false },
    passwordResetTokenHash: { type: String, select: false },
    passwordResetTokenExpiresAt: { type: Date, select: false },
    accountType: { type: String, enum: ACCOUNT_TYPES, default: 'retail', required: true },
    wholesaleStatus: { type: String, enum: WHOLESALE_STATUSES, default: 'none', required: true },
    business: {
      businessName: { type: String, trim: true, maxlength: 120 },
      gstNumber: { type: String, trim: true, uppercase: true, maxlength: 15 },
      shopProofUrl: { type: String, trim: true },
      appliedAt: { type: Date },
    },
    wholesaleReview: {
      reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
      reviewedAt: { type: Date },
      reason: { type: String, trim: true, maxlength: 500 },
    },
    addresses: { type: [addressSchema], default: [] },
    isActive: { type: Boolean, default: true },
    lastLoginAt: { type: Date },
  },
  { timestamps: true },
);

userSchema.index({ accountType: 1, wholesaleStatus: 1 });
// Reset lookups hit this directly; expiry is checked in the service, not by TTL,
// because the row must survive expiry long enough to report "link expired".
userSchema.index({ passwordResetTokenHash: 1 }, { sparse: true });
userSchema.index({ createdAt: -1 });

export const User = model<IUser>('User', userSchema);
