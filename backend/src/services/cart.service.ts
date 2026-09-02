import { Cart } from '../models/cart.model';
import { Wishlist } from '../models/wishlist.model';
import * as productRepository from '../repositories/product.repository';
import {
  effectivePriceFor,
  priceTierFor,
  serializeProduct,
  type SerializedProduct,
} from '../serializers/product.serializer';
import { ApiError } from '../utils/ApiError';
import { isProductVisibleTo } from '../utils/rbac';
import type { AuthenticatedUser } from '../types';

export interface SerializedCartItem {
  productId: string;
  product: SerializedProduct;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  /** Set when the requested quantity exceeds what is left in stock. */
  stockIssue?: string;
}

export interface SerializedCart {
  items: SerializedCartItem[];
  itemCount: number;
  subtotal: number;
  priceTier: 'retail' | 'wholesale';
  currency: string;
}

/**
 * Cart totals are always recomputed from live product documents at the viewer's
 * tier. The client never sends prices — it sends product ids and quantities.
 */
export async function getCart(viewer: AuthenticatedUser): Promise<SerializedCart> {
  const cart = await Cart.findOne({ userId: viewer.id });
  if (!cart || cart.items.length === 0) {
    return { items: [], itemCount: 0, subtotal: 0, priceTier: priceTierFor(viewer), currency: 'INR' };
  }

  const productIds = cart.items.map((item) => item.productId.toString());
  const products = await productRepository.findManyByIds(productIds);
  const productsById = new Map(products.map((product) => [product._id.toString(), product]));

  const items: SerializedCartItem[] = [];
  let removedStale = false;

  for (const item of cart.items) {
    const product = productsById.get(item.productId.toString());
    // A product deleted or deactivated since it was added is dropped silently.
    if (!product || !product.isActive) {
      removedStale = true;
      continue;
    }

    const unitPrice = effectivePriceFor(product, viewer);
    items.push({
      productId: product._id.toString(),
      product: serializeProduct(product, viewer),
      quantity: item.quantity,
      unitPrice,
      lineTotal: unitPrice * item.quantity,
      ...(product.stock < item.quantity
        ? {
            stockIssue:
              product.stock === 0
                ? 'Out of stock'
                : `Only ${product.stock} left — quantity will be reduced at checkout`,
          }
        : {}),
    });
  }

  if (removedStale) {
    cart.items = cart.items.filter((item) =>
      items.some((serialized) => serialized.productId === item.productId.toString()),
    ) as typeof cart.items;
    await cart.save();
  }

  return {
    items,
    itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
    subtotal: items.reduce((sum, item) => sum + item.lineTotal, 0),
    priceTier: priceTierFor(viewer),
    currency: 'INR',
  };
}

export async function addToCart(
  viewer: AuthenticatedUser,
  productId: string,
  quantity: number,
): Promise<SerializedCart> {
  const product = await productRepository.findById(productId);
  // A product the viewer's storefront excludes is a 404 here exactly as it is
  // on the product detail route — otherwise knowing the id would be enough to
  // buy a wholesale-only piece at the retail price.
  if (!product || !product.isActive || !isProductVisibleTo(product.visibility, viewer)) {
    throw ApiError.notFound('Product not found');
  }
  if (product.stock === 0) throw ApiError.conflict('This product is out of stock');

  const cart = await Cart.findOneAndUpdate(
    { userId: viewer.id },
    { $setOnInsert: { userId: viewer.id } },
    { new: true, upsert: true },
  );

  const existing = cart.items.find((item) => item.productId.toString() === productId);
  const nextQuantity = (existing?.quantity ?? 0) + quantity;

  if (nextQuantity > product.stock) {
    throw ApiError.conflict(
      `Only ${product.stock} in stock${existing ? ` and you already have ${existing.quantity} in your cart` : ''}.`,
    );
  }

  if (existing) {
    existing.quantity = nextQuantity;
  } else {
    cart.items.push({ productId: product._id, quantity, addedAt: new Date() } as never);
  }

  await cart.save();
  return getCart(viewer);
}

export async function updateCartItem(
  viewer: AuthenticatedUser,
  productId: string,
  quantity: number,
): Promise<SerializedCart> {
  const cart = await Cart.findOne({ userId: viewer.id });
  if (!cart) throw ApiError.notFound('Cart is empty');

  const existing = cart.items.find((item) => item.productId.toString() === productId);
  if (!existing) throw ApiError.notFound('That item is not in your cart');

  if (quantity === 0) {
    cart.items = cart.items.filter(
      (item) => item.productId.toString() !== productId,
    ) as typeof cart.items;
  } else {
    const product = await productRepository.findById(productId);
    if (!product || !product.isActive) throw ApiError.notFound('Product not found');
    if (quantity > product.stock) {
      throw ApiError.conflict(`Only ${product.stock} in stock.`);
    }
    existing.quantity = quantity;
  }

  await cart.save();
  return getCart(viewer);
}

export async function removeFromCart(
  viewer: AuthenticatedUser,
  productId: string,
): Promise<SerializedCart> {
  await Cart.updateOne({ userId: viewer.id }, { $pull: { items: { productId } } });
  return getCart(viewer);
}

export async function clearCart(userId: string): Promise<void> {
  await Cart.updateOne({ userId }, { $set: { items: [] } });
}

/* ── Wishlist (PRD 4.2) ─────────────────────────────────────────────────── */

export async function getWishlist(viewer: AuthenticatedUser): Promise<SerializedProduct[]> {
  const wishlist = await Wishlist.findOne({ userId: viewer.id });
  if (!wishlist || wishlist.productIds.length === 0) return [];

  const products = await productRepository.findManyByIds(
    wishlist.productIds.map((id) => id.toString()),
  );
  return products
    .filter((product) => product.isActive)
    .map((product) => serializeProduct(product, viewer));
}

export async function toggleWishlist(
  viewer: AuthenticatedUser,
  productId: string,
): Promise<{ wishlisted: boolean; items: SerializedProduct[] }> {
  const product = await productRepository.findById(productId);
  if (!product || !product.isActive) throw ApiError.notFound('Product not found');

  const wishlist = await Wishlist.findOneAndUpdate(
    { userId: viewer.id },
    { $setOnInsert: { userId: viewer.id } },
    { new: true, upsert: true },
  );

  const index = wishlist.productIds.findIndex((id) => id.toString() === productId);
  const wishlisted = index === -1;

  if (wishlisted) wishlist.productIds.push(product._id);
  else wishlist.productIds.splice(index, 1);

  await wishlist.save();
  return { wishlisted, items: await getWishlist(viewer) };
}
