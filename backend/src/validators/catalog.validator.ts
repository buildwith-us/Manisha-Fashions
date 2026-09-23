import { z } from 'zod';
import { objectId, paginationQuery, paise } from './common';
import { pricingIssues } from '../utils/productPricing';

/** PRD 4.2 — filter by price range and category; sort by newest or price. */
export const productListQuery = paginationQuery.extend({
  category: objectId.optional(),
  search: z.string().trim().min(1).max(120).optional(),
  minPrice: z.coerce.number().int().min(0).optional(),
  maxPrice: z.coerce.number().int().min(0).optional(),
  sort: z.enum(['newest', 'price_asc', 'price_desc', 'name_asc']).default('newest'),
  inStockOnly: z
    .union([z.literal('true'), z.literal('false'), z.boolean()])
    .optional()
    .transform((value) => value === true || value === 'true'),
  includeInactive: z
    .union([z.literal('true'), z.literal('false'), z.boolean()])
    .optional()
    .transform((value) => value === true || value === 'true'),
});

export const createProductSchema = z
  .object({
    name: z.string().trim().min(2).max(160),
    description: z.string().trim().min(1).max(4000),
    category: objectId,
    images: z.array(z.string().url()).max(10).default([]),
    // PRD 4.7 — each price is required only for a tier the product is sold
    // to (see the refinement below), and never derived from the other.
    retailPrice: paise.optional(),
    wholesalePrice: paise.optional(),
    stock: z.number().int().min(0).max(1_000_000),
    sku: z.string().trim().max(40).optional(),
    tags: z.array(z.string().trim().min(1).max(30)).max(20).default([]),
    isActive: z.boolean().default(true),
    // Which storefront the product appears in (PRD 4.2 / 4.7).
    visibility: z.enum(['both', 'retail', 'wholesale']).default('both'),
  })
  .superRefine((data, ctx) => {
    for (const issue of pricingIssues(data.visibility, data.retailPrice, data.wholesalePrice)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: issue.message, path: [issue.field] });
    }
  });

/**
 * Prices are checked in product.service instead of here: whether a price is
 * required depends on the visibility the product ends up with, which a partial
 * update may not include.
 */
export const updateProductSchema = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  description: z.string().trim().min(1).max(4000).optional(),
  category: objectId.optional(),
  images: z.array(z.string().url()).max(10).optional(),
  retailPrice: paise.optional(),
  wholesalePrice: paise.optional(),
  stock: z.number().int().min(0).max(1_000_000).optional(),
  sku: z.string().trim().max(40).optional(),
  tags: z.array(z.string().trim().min(1).max(30)).max(20).optional(),
  isActive: z.boolean().optional(),
  visibility: z.enum(['both', 'retail', 'wholesale']).optional(),
});

export const createCategorySchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).optional(),
  image: z.string().url().optional(),
  sortOrder: z.number().int().min(0).max(999).optional(),
});

export const updateCategorySchema = createCategorySchema.partial().extend({
  isActive: z.boolean().optional(),
});

export const categoryListQuery = z.object({
  includeInactive: z
    .union([z.literal('true'), z.literal('false')])
    .optional()
    .transform((value) => value === 'true'),
});

/* ── Cart & wishlist ────────────────────────────────────────────────────── */

export const addToCartSchema = z.object({
  productId: objectId,
  quantity: z.number().int().min(1).max(999).default(1),
});

export const updateCartItemSchema = z.object({
  // 0 removes the line, which is what a stepper hitting zero should do.
  quantity: z.number().int().min(0).max(999),
});

export const productIdParam = z.object({ productId: objectId });

/* ── Reviews ────────────────────────────────────────────────────────────── */

export const reviewListQuery = paginationQuery;

export const upsertReviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(2000).optional(),
});
