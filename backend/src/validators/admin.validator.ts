import { z } from 'zod';
import { ACCOUNT_TYPES, WHOLESALE_STATUSES } from '../types';
import { objectId, paginationQuery } from './common';

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

