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

export interface IUser extends Document<Types.ObjectId> {
  _id: Types.ObjectId;
  phone: string;
  name?: string;
  email?: string;
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
      required: true,
      unique: true,
      trim: true,
      // Stored in E.164 (e.g. +919876543210) so lookups are unambiguous.
      match: /^\+[1-9]\d{7,14}$/,
    },
    name: { type: String, trim: true, maxlength: 80 },
    email: { type: String, trim: true, lowercase: true, maxlength: 160 },
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
userSchema.index({ createdAt: -1 });

export const User = model<IUser>('User', userSchema);
