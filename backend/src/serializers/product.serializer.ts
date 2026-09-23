import type { IProduct } from '../models/product.model';
import type { ICategory } from '../models/category.model';
import type { AuthenticatedUser } from '../types';
import { ApiError } from '../utils/ApiError';
import { tierPriceOf } from '../utils/productPricing';
import { canSeeWholesalePricing } from '../utils/rbac';

/**
 * PRD 4.2 / 8.4 / 8.8 — wholesalePrice is stripped from the response entirely
 * for retail and unapproved accounts.
 *
 * This is THE enforcement point. It is server-side on purpose: a modified
 * client or an intercepted request must not be able to surface wholesale
 * pricing, so no code path may return a raw Product document to a client.
 */
export interface SerializedProduct {
  id: string;
  name: string;
  description: string;
  category: { id: string; name: string; slug: string } | null;
  images: string[];
  /** The price this viewer actually pays, in paise. */
  price: number;
  priceTier: 'retail' | 'wholesale';
  /** Absent on a wholesale-only product. */
  retailPrice?: number;
  /**
   * Present only for approved wholesale accounts, staff and admin — and only
   * on a product sold to wholesale buyers. Never derived from retail.
   */
  wholesalePrice?: number;
  stock: number;
  inStock: boolean;
  sku?: string;
  tags: string[];
  isActive: boolean;
  /** Which storefront this product appears in. */
  visibility: 'both' | 'retail' | 'wholesale';
  /**
   * Aggregate rating. Computed from the reviews collection rather than stored
   * on the product, so it cannot drift out of sync with the reviews it
   * summarises. Zero count means "no reviews yet", not "rated zero".
   */
  rating: { average: number; count: number };
  createdAt: string;
  updatedAt: string;
}

type ProductLike = IProduct & { category: ICategory | IProduct['category'] };

function serializeCategory(category: ProductLike['category']): SerializedProduct['category'] {
  if (!category) return null;
  if (typeof category === 'object' && 'name' in category) {
    const populated = category as ICategory;
    return {
      id: populated._id.toString(),
      name: populated.name,
      slug: populated.slug,
    };
  }
  return null;
}

export function serializeProduct(
  product: IProduct,
  viewer?: AuthenticatedUser | null,
  rating?: { average: number; count: number },
): SerializedProduct {
  const wholesaleVisible = canSeeWholesalePricing(viewer?.accountType, viewer?.wholesaleStatus);
  // Staff/admin see wholesale pricing for management, but they are not buyers —
  // only an approved wholesale account is charged the wholesale tier.
  const buysAtWholesale =
    viewer?.accountType === 'wholesale' && viewer.wholesaleStatus === 'approved';

  const retailPrice = tierPriceOf(product, 'retail');
  const wholesalePrice = tierPriceOf(product, 'wholesale');
  // A buyer only ever sees products sold at their tier (the storefront
  // filter), so their tier's price exists. Staff and admin are not buyers:
  // they see retail where there is one, else the wholesale-only price.
  const tierPrice = buysAtWholesale ? wholesalePrice : retailPrice;
  // `?? 0` is display-only for a product with no price at all, which
  // validation prevents; charging goes through effectivePriceFor, which refuses.
  const price = tierPrice ?? wholesalePrice ?? retailPrice ?? 0;

  return {
    id: product._id.toString(),
    name: product.name,
    description: product.description,
    category: serializeCategory((product as unknown as ProductLike).category),
    images: product.images,
    price,
    priceTier: buysAtWholesale || retailPrice === undefined ? 'wholesale' : 'retail',
    ...(retailPrice !== undefined ? { retailPrice } : {}),
    ...(wholesaleVisible && wholesalePrice !== undefined ? { wholesalePrice } : {}),
    stock: product.stock,
    inStock: product.stock > 0,
    ...(product.sku ? { sku: product.sku } : {}),
    tags: product.tags ?? [],
    isActive: product.isActive,
    visibility: product.visibility ?? 'both',
    rating: rating ?? { average: 0, count: 0 },
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
  };
}

export function serializeProducts(
  products: IProduct[],
  viewer?: AuthenticatedUser | null,
  ratings?: Map<string, { average: number; count: number }>,
): SerializedProduct[] {
  return products.map((product) =>
    serializeProduct(product, viewer, ratings?.get(product._id.toString())),
  );
}

/**
 * The price the given viewer is charged. Used by cart and order pricing so the
 * tier decision lives in exactly one place.
 */
export function effectivePriceFor(product: IProduct, viewer: AuthenticatedUser): number {
  const price = tierPriceOf(product, priceTierFor(viewer));
  // Unreachable through the storefront checks, which every cart and order path
  // applies first. Refusing beats charging a price the product does not have.
  if (price === undefined) {
    throw ApiError.conflict(`"${product.name}" is not sold at your price tier.`);
  }
  return price;
}

export function priceTierFor(viewer: AuthenticatedUser): 'retail' | 'wholesale' {
  return viewer.accountType === 'wholesale' && viewer.wholesaleStatus === 'approved'
    ? 'wholesale'
    : 'retail';
}
