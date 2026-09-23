import { Category, slugify } from '../models/category.model';
import * as productRepository from '../repositories/product.repository';
import * as reviewService from './review.service';
import type { ProductQuery } from '../repositories/product.repository';
import {
  serializeProduct,
  serializeProducts,
  type SerializedProduct,
} from '../serializers/product.serializer';
import { ApiError } from '../utils/ApiError';
import {
  needsRetailPrice,
  needsWholesalePrice,
  pricingIssues,
  type PricingIssue,
} from '../utils/productPricing';
// Storefront visibility lives in utils/rbac.ts so that the paths which take a
// product id straight from the client — detail, cart, Buy now, checkout — all
// answer the question the same way.
import { PERMISSIONS, isProductVisibleTo, storefrontFor } from '../utils/rbac';
import type { AuthenticatedUser } from '../types';

export interface ProductListResult {
  items: SerializedProduct[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasMore: boolean;
  };
}

export async function listProducts(
  query: ProductQuery,
  viewer?: AuthenticatedUser | null,
): Promise<ProductListResult> {
  const result = await productRepository.findPaginated({
    ...query,
    storefront: storefrontFor(viewer),
  });

  // One aggregate for the whole page rather than a query per card.
  const ratings = await reviewService.summariesFor(
    result.items.map((item) => item._id.toString()),
  );

  return {
    items: serializeProducts(result.items, viewer, ratings),
    pagination: {
      page: result.page,
      limit: result.limit,
      total: result.total,
      totalPages: result.totalPages,
      hasMore: result.hasMore,
    },
  };
}

export async function getProduct(
  id: string,
  viewer?: AuthenticatedUser | null,
): Promise<SerializedProduct> {
  const product = await productRepository.findById(id);
  if (!product) throw ApiError.notFound('Product not found');

  // A deactivated product stays reachable for staff (so they can re-publish it)
  // but is a 404 for customers.
  const isStaff = viewer?.accountType === 'admin' || viewer?.accountType === 'staff';
  if (!product.isActive && !isStaff) throw ApiError.notFound('Product not found');

  // Same rule as the list, applied again here: without it a shared link would
  // reach a product the viewer's storefront excludes.
  if (!isProductVisibleTo(product.visibility, viewer)) {
    throw ApiError.notFound('Product not found');
  }

  const rating = await reviewService.summaryFor(product._id.toString());
  return serializeProduct(product, viewer, { average: rating.average, count: rating.count });
}

export interface ProductInput {
  name: string;
  description: string;
  category: string;
  images?: string[];
  /** Required unless the product is wholesale-only. */
  retailPrice?: number;
  /** Required unless the product is retail-only. */
  wholesalePrice?: number;
  stock: number;
  sku?: string;
  tags?: string[];
  isActive?: boolean;
  visibility?: 'both' | 'retail' | 'wholesale';
}

/** Same status, code and shape as a request-validation failure. */
function pricingError(issues: PricingIssue[]): ApiError {
  return new ApiError(422, issues[0].message, 'VALIDATION_ERROR', issues);
}

async function assertCategoryExists(categoryId: string): Promise<void> {
  const exists = await Category.exists({ _id: categoryId });
  if (!exists) throw ApiError.badRequest('The selected category does not exist');
}

export async function createProduct(
  input: ProductInput,
  actor: AuthenticatedUser,
): Promise<SerializedProduct> {
  // PRD 8.9 — staff have product management but no pricing rights. Creation
  // requires both prices (PRD 4.7: both required, no auto-derived default),
  // so creating a product is inherently an admin action.
  if (!actor.permissions.includes(PERMISSIONS.PRODUCT_PRICE_MANAGE)) {
    throw ApiError.forbidden(
      'Creating a product requires setting retail and wholesale prices, which is an admin-only action.',
    );
  }

  const visibility = input.visibility ?? 'both';
  const issues = pricingIssues(visibility, input.retailPrice, input.wholesalePrice);
  if (issues.length > 0) throw pricingError(issues);

  await assertCategoryExists(input.category);
  // A price for a tier the product is not sold to is dropped, not stored.
  const product = await productRepository.create({
    ...input,
    visibility,
    retailPrice: needsRetailPrice(visibility) ? input.retailPrice : undefined,
    wholesalePrice: needsWholesalePrice(visibility) ? input.wholesalePrice : undefined,
  });
  return serializeProduct(product, actor);
}

export async function updateProduct(
  id: string,
  input: Partial<ProductInput>,
  actor: AuthenticatedUser,
): Promise<SerializedProduct> {
  const canPrice = actor.permissions.includes(PERMISSIONS.PRODUCT_PRICE_MANAGE);
  const touchesPricing = input.retailPrice !== undefined || input.wholesalePrice !== undefined;
  if (touchesPricing && !canPrice) {
    throw ApiError.forbidden('Only an admin can change product pricing.');
  }

  const existing = await productRepository.findById(id);
  if (!existing) throw ApiError.notFound('Product not found');

  // Checked against the product as it will be after the update: switching a
  // retail-only product to "both" needs a wholesale price, whether it arrives
  // in this request or is already stored.
  const visibility = input.visibility ?? existing.visibility ?? 'both';
  const retailPrice = input.retailPrice ?? existing.retailPrice;
  const wholesalePrice = input.wholesalePrice ?? existing.wholesalePrice;
  const issues = pricingIssues(visibility, retailPrice, wholesalePrice);
  if (issues.length > 0) {
    throw canPrice
      ? pricingError(issues)
      : ApiError.forbidden(
          `${issues[0].message} Only an admin can set prices, so ask an admin to make this change.`,
        );
  }

  if (input.category) await assertCategoryExists(input.category);

  const { retailPrice: _retail, wholesalePrice: _wholesale, ...rest } = input;
  const set = {
    ...rest,
    ...(input.retailPrice !== undefined && needsRetailPrice(visibility)
      ? { retailPrice: input.retailPrice }
      : {}),
    ...(input.wholesalePrice !== undefined && needsWholesalePrice(visibility)
      ? { wholesalePrice: input.wholesalePrice }
      : {}),
  };
  // An admin moving a product to one tier clears the other tier's price, so a
  // retail-only product holds no wholesale price at all. Staff cannot change
  // prices, so on their edits a stale price stays stored — the serializer and
  // effectivePriceFor ignore it either way.
  const unset = canPrice
    ? [
        ...(!needsRetailPrice(visibility) ? ['retailPrice' as const] : []),
        ...(!needsWholesalePrice(visibility) ? ['wholesalePrice' as const] : []),
      ]
    : [];

  const product = await productRepository.updateById(id, set, unset);
  if (!product) throw ApiError.notFound('Product not found');
  return serializeProduct(product, actor);
}

export async function deleteProduct(id: string): Promise<void> {
  const deleted = await productRepository.deleteById(id);
  if (!deleted) throw ApiError.notFound('Product not found');
}

/* ── Categories ─────────────────────────────────────────────────────────── */

export async function listCategories(includeInactive = false) {
  const filter = includeInactive ? {} : { isActive: true };
  const categories = await Category.find(filter).sort({ sortOrder: 1, name: 1 });
  return categories.map((category) => ({
    id: category._id.toString(),
    name: category.name,
    slug: category.slug,
    description: category.description,
    image: category.image,
    sortOrder: category.sortOrder,
    isActive: category.isActive,
  }));
}

export async function createCategory(input: {
  name: string;
  description?: string;
  image?: string;
  sortOrder?: number;
}) {
  const slug = slugify(input.name);
  const existing = await Category.findOne({ slug });
  if (existing) throw ApiError.conflict('A category with this name already exists');

  const category = await Category.create({ ...input, slug });
  return {
    id: category._id.toString(),
    name: category.name,
    slug: category.slug,
    description: category.description,
    image: category.image,
    sortOrder: category.sortOrder,
    isActive: category.isActive,
  };
}

export async function updateCategory(
  id: string,
  input: { name?: string; description?: string; image?: string; sortOrder?: number; isActive?: boolean },
) {
  const update: Record<string, unknown> = { ...input };
  if (input.name) update.slug = slugify(input.name);

  const category = await Category.findByIdAndUpdate(id, { $set: update }, { new: true });
  if (!category) throw ApiError.notFound('Category not found');

  return {
    id: category._id.toString(),
    name: category.name,
    slug: category.slug,
    description: category.description,
    image: category.image,
    sortOrder: category.sortOrder,
    isActive: category.isActive,
  };
}

export async function deleteCategory(id: string): Promise<void> {
  const { Product } = await import('../models/product.model');
  const inUse = await Product.countDocuments({ category: id });
  if (inUse > 0) {
    throw ApiError.conflict(
      `This category still has ${inUse} product(s). Move or delete them first.`,
    );
  }
  const deleted = await Category.findByIdAndDelete(id);
  if (!deleted) throw ApiError.notFound('Category not found');
}
