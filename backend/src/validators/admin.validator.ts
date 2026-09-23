import { z } from 'zod';
import { ACCOUNT_TYPES, WHOLESALE_STATUSES } from '../types';
import { objectId, paginationQuery, paise } from './common';

export const wholesaleListQuery = paginationQuery.extend({
  status: z.enum(WHOLESALE_STATUSES).optional(),
});

export const reviewWholesaleSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  reason: z.string().trim().max(500).optional(),
});

export const userListQuery = paginationQuery.extend({
  accountType: z.enum(ACCOUNT_TYPES).optional(),
  search: z.string().trim().max(80).optional(),
});

export const setRoleSchema = z.object({
  // Wholesale is granted through the approval flow, not by direct assignment.
  accountType: z.enum(['retail', 'staff', 'admin']),
});

export const setActiveSchema = z.object({
  isActive: z.boolean(),
});

/* ── COD settings (PRD 4.4 / 6) ─────────────────────────────────────────── */

/**
 * The state travels in the path, so it is URL-decoded by Express before it
 * gets here. Bounded to the same 2–80 characters an address's state field
 * accepts — there is no enum to check against, because addresses store the
 * state as free text.
 */
export const codStateParam = z.object({
  state: z.string().trim().min(2, 'Enter a state name').max(80),
});

export const upsertCodStateSchema = z.object({
  codEnabled: z.boolean(),
  /** Integer paise, like every price in this API. */
  codCharge: paise,
});
