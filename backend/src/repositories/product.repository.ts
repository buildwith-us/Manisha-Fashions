import { FilterQuery, type SortOrder, type Types } from 'mongoose';
import { Product, type IProduct } from '../models/product.model';

/**
 * Write shape accepted from the service layer. `category` arrives as a string
 * id from the request body; Mongoose casts it to an ObjectId on save.
 */
export type ProductWriteInput = Omit<Partial<IProduct>, 'category'> & {
  category?: string | Types.ObjectId;
};

/**
 * Repository layer (PRD 8.6) — the only place that talks to the Product
 * collection. Services stay free of query syntax.
 */

export interface ProductQuery {
  page: number;
  limit: number;
  category?: string;
  search?: string;
  minPrice?: number;
  maxPrice?: number;
  sort: 'newest' | 'price_asc' | 'price_desc' | 'name_asc';
  includeInactive?: boolean;
  inStockOnly?: boolean;
  /**
   * Which storefront the viewer is browsing. 'all' (staff and admin) applies no
   * visibility filter; otherwise only products marked for that storefront —
   * or for both — are returned.
   */
  storefront?: 'retail' | 'wholesale' | 'all';
}

export interface PaginatedProducts {
  items: IProduct[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasMore: boolean;
}

const SORT_MAP: Record<ProductQuery['sort'], Record<string, SortOrder>> = {
  newest: { createdAt: -1 },
  price_asc: { retailPrice: 1 },
  price_desc: { retailPrice: -1 },
  name_asc: { name: 1 },
};

function buildFilter(query: ProductQuery): FilterQuery<IProduct> {
  const filter: FilterQuery<IProduct> = {};

  if (!query.includeInactive) filter.isActive = true;
  if (query.category) filter.category = query.category;

  // Retail-only products stay out of the wholesale storefront and vice versa.
  // Enforced here, in the query, so a product the viewer may not see is never
  // loaded — not merely hidden after the fact.
  if (query.storefront && query.storefront !== 'all') {
    filter.visibility = { $in: ['both', query.storefront] };
  }
  if (query.inStockOnly) filter.stock = { $gt: 0 };

  // Filter by price range always applies to retailPrice: it is the tier every
  // account can see, so the filter means the same thing for every viewer.
  if (query.minPrice !== undefined || query.maxPrice !== undefined) {
    filter.retailPrice = {};
    if (query.minPrice !== undefined) filter.retailPrice.$gte = query.minPrice;
    if (query.maxPrice !== undefined) filter.retailPrice.$lte = query.maxPrice;
  }

  if (query.search) {
    const escaped = query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(escaped, 'i');
    filter.$or = [{ name: pattern }, { description: pattern }, { tags: pattern }];
  }

  return filter;
}

export async function findPaginated(query: ProductQuery): Promise<PaginatedProducts> {
  const filter = buildFilter(query);
  const skip = (query.page - 1) * query.limit;

  const [items, total] = await Promise.all([
    Product.find(filter)
      .populate('category', 'name slug')
      .sort(SORT_MAP[query.sort])
      .skip(skip)
      .limit(query.limit)
      .exec(),
    Product.countDocuments(filter),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / query.limit));

  return {
    items,
    total,
    page: query.page,
    limit: query.limit,
    totalPages,
    hasMore: query.page < totalPages,
  };
}

export async function findById(id: string): Promise<IProduct | null> {
  return Product.findById(id).populate('category', 'name slug').exec();
}

export async function findManyByIds(ids: string[]): Promise<IProduct[]> {
  return Product.find({ _id: { $in: ids } })
    .populate('category', 'name slug')
    .exec();
}

export async function create(data: ProductWriteInput): Promise<IProduct> {
  const product = await Product.create(data);
  return product.populate('category', 'name slug');
}

export async function updateById(id: string, data: ProductWriteInput): Promise<IProduct | null> {
  return Product.findByIdAndUpdate(id, { $set: data }, { new: true, runValidators: true })
    .populate('category', 'name slug')
    .exec();
}

export async function deleteById(id: string): Promise<IProduct | null> {
  return Product.findByIdAndDelete(id).exec();
}

/**
 * Atomically decrements stock only if enough remains, so two concurrent
 * checkouts cannot oversell the same piece.
 */
export async function decrementStock(id: string, quantity: number): Promise<boolean> {
  const result = await Product.updateOne(
    { _id: id, stock: { $gte: quantity } },
    { $inc: { stock: -quantity } },
  );
  return result.modifiedCount === 1;
}

export async function incrementStock(id: string, quantity: number): Promise<void> {
  await Product.updateOne({ _id: id }, { $inc: { stock: quantity } });
}

export async function findLowStock(threshold: number, limit = 20): Promise<IProduct[]> {
  return Product.find({ isActive: true, stock: { $lte: threshold } })
    .sort({ stock: 1 })
    .limit(limit)
    .populate('category', 'name slug')
    .exec();
}

export async function countAll(includeInactive = false): Promise<number> {
  return Product.countDocuments(includeInactive ? {} : { isActive: true });
}
