import { z } from 'zod';

/** A 24-character hex Mongo ObjectId. */
export const objectId = z
  .string()
  .regex(/^[0-9a-fA-F]{24}$/, 'Must be a valid id');

export const objectIdParam = (key = 'id') => z.object({ [key]: objectId });

/**
 * Accepts a bare 10-digit Indian mobile number or a full E.164 string and
 * normalises to E.164, so the same person always maps to one account.
 */
export const phoneNumber = z
  .string()
  .trim()
  .transform((value) => value.replace(/[\s()-]/g, ''))
  .refine(
    (value) => /^\+?[1-9]\d{7,14}$/.test(value) || /^[6-9]\d{9}$/.test(value),
    'Enter a valid mobile number',
  )
  .transform((value) => {
    if (value.startsWith('+')) return value;
    if (/^[6-9]\d{9}$/.test(value)) return `+91${value}`;
    return `+${value}`;
  });

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/** Monetary amounts are integer paise everywhere in this API. */
export const paise = z
  .number({ invalid_type_error: 'Price must be a number of paise' })
  .int('Price must be a whole number of paise')
  .min(0, 'Price cannot be negative')
  .max(100_000_000, 'Price is unrealistically high');
