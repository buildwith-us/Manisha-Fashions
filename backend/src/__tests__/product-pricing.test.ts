import {
  api,
  clearTestDb,
  connectTestDb,
  createTestUser,
  disconnectTestDb,
  request,
  seedCart,
} from './helpers/testServer';
import { Category, slugify } from '../models/category.model';
import { Product } from '../models/product.model';

/**
 * Prices follow who a product is sold to (PRD 4.7):
 *   retail → retail price only · wholesale → wholesale price only · both → both.
 * No price is ever derived from the other.
 */

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
afterEach(clearTestDb);

/** One shared category per test — the slug is unique. */
async function categoryId(): Promise<string> {
  const category =
    (await Category.findOne({ slug: slugify('bangles') })) ??
    (await Category.create({ name: 'Bangles', slug: slugify('bangles') }));
  return category._id.toString();
}

async function productBody(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Antique Gold Bangle',
    description: 'Hand-finished.',
    category: await categoryId(),
    stock: 5,
    ...overrides,
  };
}

async function createAs(auth: string, overrides: Record<string, unknown>) {
  return request
    .post(api('/products'))
    .set('Authorization', auth)
    .send(await productBody(overrides));
}

describe('creating a product', () => {
  it('saves a retail-only product with just a retail price', async () => {
    const admin = await createTestUser({ accountType: 'admin' });

    const res = await createAs(admin.auth, { visibility: 'retail', retailPrice: 120_000 });

    expect(res.status).toBe(201);
    expect(res.body.data.retailPrice).toBe(120_000);
    expect(res.body.data).not.toHaveProperty('wholesalePrice');
    const stored = await Product.findById(res.body.data.id).lean();
    expect(stored?.wholesalePrice).toBeUndefined();
  });

  it('drops a wholesale price sent for a retail-only product rather than storing it', async () => {
    const admin = await createTestUser({ accountType: 'admin' });

    const res = await createAs(admin.auth, {
      visibility: 'retail',
      retailPrice: 120_000,
      wholesalePrice: 90_000,
    });

    expect(res.status).toBe(201);
    const stored = await Product.findById(res.body.data.id).lean();
    expect(stored?.wholesalePrice).toBeUndefined();
  });

  it('saves a wholesale-only product with just a wholesale price', async () => {
    const admin = await createTestUser({ accountType: 'admin' });

    const res = await createAs(admin.auth, { visibility: 'wholesale', wholesalePrice: 80_000 });

    expect(res.status).toBe(201);
    expect(res.body.data.wholesalePrice).toBe(80_000);
    expect(res.body.data).not.toHaveProperty('retailPrice');
  });

  it.each([
    ['wholesale', { retailPrice: 120_000 }],
    ['retail', { wholesalePrice: 90_000 }],
  ])('rejects a "both" product missing its %s price', async (missing, prices) => {
    const admin = await createTestUser({ accountType: 'admin' });

    const res = await createAs(admin.auth, { visibility: 'both', ...prices });

    expect(res.status).toBe(422);
    expect(res.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: `${missing}Price` })]),
    );
    await expect(Product.countDocuments()).resolves.toBe(0);
  });

  it('defaults to "both" and so still needs both prices when visibility is omitted', async () => {
    const admin = await createTestUser({ accountType: 'admin' });

    const res = await createAs(admin.auth, { retailPrice: 120_000 });

    expect(res.status).toBe(422);
  });

  it('rejects a retail-only product with no retail price', async () => {
    const admin = await createTestUser({ accountType: 'admin' });

    const res = await createAs(admin.auth, { visibility: 'retail', wholesalePrice: 90_000 });

    expect(res.status).toBe(422);
  });
});

describe('updating a product', () => {
  async function bothProduct(adminAuth: string) {
    const res = await createAs(adminAuth, {
      visibility: 'both',
      retailPrice: 120_000,
      wholesalePrice: 90_000,
    });
    return res.body.data.id as string;
  }

  it('clears the wholesale price when an admin makes a product retail-only', async () => {
    const admin = await createTestUser({ accountType: 'admin' });
    const id = await bothProduct(admin.auth);

    const res = await request
      .patch(api(`/products/${id}`))
      .set('Authorization', admin.auth)
      .send({ visibility: 'retail', retailPrice: 125_000 });

    expect(res.status).toBe(200);
    const stored = await Product.findById(id).lean();
    expect(stored?.retailPrice).toBe(125_000);
    expect(stored?.wholesalePrice).toBeUndefined();
  });

  it('refuses to open a retail-only product to wholesale without a wholesale price', async () => {
    const admin = await createTestUser({ accountType: 'admin' });
    const created = await createAs(admin.auth, { visibility: 'retail', retailPrice: 120_000 });

    const refused = await request
      .patch(api(`/products/${created.body.data.id}`))
      .set('Authorization', admin.auth)
      .send({ visibility: 'both' });
    expect(refused.status).toBe(422);
    expect(refused.body.error.details[0].field).toBe('wholesalePrice');

    const accepted = await request
      .patch(api(`/products/${created.body.data.id}`))
      .set('Authorization', admin.auth)
      .send({ visibility: 'both', wholesalePrice: 95_000 });
    expect(accepted.status).toBe(200);
    expect(accepted.body.data.wholesalePrice).toBe(95_000);
  });

  it('still rejects a wholesale price above retail on a "both" product', async () => {
    const admin = await createTestUser({ accountType: 'admin' });
    const id = await bothProduct(admin.auth);

    const res = await request
      .patch(api(`/products/${id}`))
      .set('Authorization', admin.auth)
      .send({ wholesalePrice: 200_000 });

    expect(res.status).toBe(422);
  });

  it('will not let staff open a product to a tier it has no price for', async () => {
    const admin = await createTestUser({ accountType: 'admin' });
    const staff = await createTestUser({ accountType: 'staff' });
    const created = await createAs(admin.auth, { visibility: 'retail', retailPrice: 120_000 });

    const res = await request
      .patch(api(`/products/${created.body.data.id}`))
      .set('Authorization', staff.auth)
      .send({ visibility: 'both' });

    expect(res.status).toBe(403);
  });
});

describe('GET /products by viewer', () => {
  async function seedCatalogue() {
    const admin = await createTestUser({ accountType: 'admin' });
    const retailOnly = await createAs(admin.auth, {
      name: 'Retail Only Ring',
      visibility: 'retail',
      retailPrice: 50_000,
    });
    const tradeOnly = await createAs(admin.auth, {
      name: 'Trade Only Chain',
      visibility: 'wholesale',
      wholesalePrice: 40_000,
    });
    const both = await createAs(admin.auth, {
      name: 'Everyone Earrings',
      visibility: 'both',
      retailPrice: 30_000,
      wholesalePrice: 20_000,
    });
    return {
      retailOnly: retailOnly.body.data.id as string,
      tradeOnly: tradeOnly.body.data.id as string,
      both: both.body.data.id as string,
    };
  }

  it('never shows an approved wholesale buyer a retail-only product', async () => {
    const ids = await seedCatalogue();
    const trade = await createTestUser({ accountType: 'wholesale' });

    const res = await request.get(api('/products')).set('Authorization', trade.auth).expect(200);
    const listed = new Map(res.body.data.map((item: { id: string }) => [item.id, item]));

    expect(listed.has(ids.retailOnly)).toBe(false);
    expect(listed.get(ids.tradeOnly)).toMatchObject({ price: 40_000, priceTier: 'wholesale' });
    expect(listed.get(ids.tradeOnly)).not.toHaveProperty('retailPrice');
    expect(listed.get(ids.both)).toMatchObject({ price: 20_000, wholesalePrice: 20_000 });

    await request
      .get(api(`/products/${ids.retailOnly}`))
      .set('Authorization', trade.auth)
      .expect(404);
  });

  it('never shows a retail customer a wholesale-only product or any wholesale price', async () => {
    const ids = await seedCatalogue();
    const shopper = await createTestUser();

    const res = await request.get(api('/products')).set('Authorization', shopper.auth).expect(200);
    const listedIds = res.body.data.map((item: { id: string }) => item.id);

    expect(listedIds).not.toContain(ids.tradeOnly);
    expect(listedIds).toEqual(expect.arrayContaining([ids.retailOnly, ids.both]));
    for (const item of res.body.data) expect(item).not.toHaveProperty('wholesalePrice');
  });

  it('sorts a wholesale buyer by the wholesale price they see', async () => {
    await seedCatalogue();
    const trade = await createTestUser({ accountType: 'wholesale' });

    const res = await request
      .get(api('/products?sort=price_asc'))
      .set('Authorization', trade.auth)
      .expect(200);

    const prices = res.body.data.map((item: { price: number }) => item.price);
    expect(prices).toEqual([20_000, 40_000]);
  });
});

describe('a product moved out of a buyer\'s storefront', () => {
  it('drops out of a wholesale cart instead of pricing it from nothing', async () => {
    const admin = await createTestUser({ accountType: 'admin' });
    const trade = await createTestUser({ accountType: 'wholesale' });
    const created = await createAs(admin.auth, {
      visibility: 'both',
      retailPrice: 120_000,
      wholesalePrice: 90_000,
    });
    await seedCart(trade.id, created.body.data.id, 1);

    await request
      .patch(api(`/products/${created.body.data.id}`))
      .set('Authorization', admin.auth)
      .send({ visibility: 'retail' })
      .expect(200);

    const cart = await request.get(api('/cart')).set('Authorization', trade.auth).expect(200);
    expect(cart.body.data.items).toHaveLength(0);
    expect(cart.body.data.subtotal).toBe(0);
  });
});
