import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import supertest from 'supertest';
import { createApp } from '../../app';
import { env } from '../../config/env';
import { Cart } from '../../models/cart.model';
import { Category, slugify } from '../../models/category.model';
import { Product } from '../../models/product.model';
import { User, type IUser } from '../../models/user.model';
import { signAccessToken } from '../../services/token.service';
import type { AccountType } from '../../types';

/**
 * Test harness: the real Express app, in process, over Supertest, against a
 * per-file in-memory mongod. No live server and no shared database, so files
 * can be read in any order without leaking state into each other.
 */

let mongod: MongoMemoryServer | null = null;

export const request = supertest(createApp());

/** Every path is mounted under the configured prefix (default /api/v1). */
export const api = (path: string) => `${env.API_PREFIX}${path}`;

export async function connectTestDb(): Promise<void> {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
}

export async function disconnectTestDb(): Promise<void> {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  await mongod?.stop();
  mongod = null;
}

/** Wipes every collection between tests without paying for another mongod. */
export async function clearTestDb(): Promise<void> {
  const collections = await mongoose.connection.db!.collections();
  await Promise.all(collections.map((collection) => collection.deleteMany({})));

  // Rate-limit counters and password-reset lockouts live in an in-process
  // key-value store, not in Mongo, so wiping collections alone leaves them
  // behind. They are keyed by email and IP, and every test request comes from
  // the same IP — without this, one spec's requests spend the next spec's
  // quota and it sees a 429 it never asked for.
  const { disconnectStore, initStore } = await import('../../config/store');
  await disconnectStore();
  initStore();
}

export interface TestAddressInput {
  state: string;
  city?: string;
  pincode?: string;
}

export interface TestUser {
  id: string;
  document: IUser;
  /** Ready-made `Authorization` header value. */
  auth: string;
  /** The saved address's id, when one was requested. */
  addressId: string;
}

let userCounter = 0;

export async function createTestUser(
  options: { accountType?: AccountType; address?: TestAddressInput } = {},
): Promise<TestUser> {
  userCounter += 1;
  const accountType = options.accountType ?? 'retail';

  const user = await User.create({
    name: `Test ${accountType} ${userCounter}`,
    email: `test-${accountType}-${userCounter}@example.com`,
    phone: `+9198765${String(10000 + userCounter).slice(-5)}`,
    accountType,
    wholesaleStatus: accountType === 'wholesale' ? 'approved' : 'none',
    authProviders: ['password'],
    isActive: true,
    addresses: options.address
      ? [
          {
            label: 'Home',
            fullName: 'Test Buyer',
            phone: '+919876500000',
            line1: '12 Test Street',
            city: options.address.city ?? 'Testville',
            state: options.address.state,
            pincode: options.address.pincode ?? '411001',
            isDefault: true,
          },
        ]
      : [],
  });

  return {
    id: user._id.toString(),
    document: user,
    auth: `Bearer ${signAccessToken(user)}`,
    addressId: user.addresses[0]?._id.toString() ?? '',
  };
}

let productCounter = 0;

/** A single in-stock, retail-visible product, with its category. */
export async function createTestProduct(
  options: { retailPrice?: number; stock?: number } = {},
): Promise<{ id: string; retailPrice: number }> {
  productCounter += 1;
  const name = `Test Product ${productCounter}`;

  const category = await Category.create({
    name: `Test Category ${productCounter}`,
    slug: slugify(`test-category-${productCounter}`),
  });

  const retailPrice = options.retailPrice ?? 100_000; // ₹1,000
  const product = await Product.create({
    name,
    description: 'A product that exists only for tests.',
    category: category._id,
    retailPrice,
    wholesalePrice: Math.round(retailPrice * 0.8),
    stock: options.stock ?? 10,
    isActive: true,
    visibility: 'both',
  });

  return { id: product._id.toString(), retailPrice };
}

export async function seedCart(userId: string, productId: string, quantity = 1): Promise<void> {
  await Cart.create({ userId, items: [{ productId, quantity }] });
}
