import { z } from 'zod';
import { objectId, phoneNumber } from './common';

export const sendOtpSchema = z.object({
  phone: phoneNumber,
});

const wholesaleApplication = z.object({
  businessName: z.string().trim().min(2).max(120).optional(),
  // PRD 6 — whether document upload is mandatory is still an open item, so the
  // fields exist and are accepted but are not required to submit.
  gstNumber: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/, 'Enter a valid GSTIN')
    .optional(),
  shopProofUrl: z.string().url().optional(),
});

export const verifyOtpSchema = z.object({
  phone: phoneNumber,
  code: z
    .string()
    .trim()
    .regex(/^\d{4,8}$/, 'Enter the code from your SMS'),
  // Only retail or wholesale — admin and staff roles are never client-assignable.
  accountType: z.enum(['retail', 'wholesale']).default('retail'),
  application: wholesaleApplication.optional(),
  deviceId: z.string().max(120).optional(),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(20, 'A refresh token is required'),
  deviceId: z.string().max(120).optional(),
});

export const logoutSchema = z.object({
  refreshToken: z.string().min(20),
});

export const updateProfileSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  email: z.string().trim().email().max(160).optional(),
});

export const applyWholesaleSchema = wholesaleApplication;

export const addressSchema = z.object({
  label: z.string().trim().max(40).optional(),
  fullName: z.string().trim().min(2).max(80),
  phone: phoneNumber,
  line1: z.string().trim().min(4).max(200),
  line2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(2).max(80),
  state: z.string().trim().min(2).max(80),
  pincode: z.string().trim().regex(/^[1-9][0-9]{5}$/, 'Enter a valid 6-digit PIN code'),
  isDefault: z.boolean().optional(),
});

export const addressUpdateSchema = addressSchema.partial();

export const userIdParam = z.object({ userId: objectId });
