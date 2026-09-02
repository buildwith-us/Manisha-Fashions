/**
 * Seeds a workable catalog and the first admin account.
 *
 * Run with: npm run seed
 * Safe to re-run — it upserts by natural key rather than wiping the database.
 */
import { connectDatabase, disconnectDatabase } from '../config/database';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { Category, slugify } from '../models/category.model';
import { Product } from '../models/product.model';
import { User } from '../models/user.model';

/** Prices are stored in paise; ₹ figures here are converted at the point of use. */
const rupees = (amount: number) => Math.round(amount * 100);

const CATEGORIES = [
  { name: 'Necklaces', description: 'Chains, chokers and statement necklaces', sortOrder: 1 },
  { name: 'Earrings', description: 'Studs, jhumkas, hoops and danglers', sortOrder: 2 },
  { name: 'Bangles & Bracelets', description: 'Bangles, kadas and bracelets', sortOrder: 3 },
  { name: 'Rings', description: 'Everyday and occasion rings', sortOrder: 4 },
  { name: 'Bridal Sets', description: 'Complete bridal jewellery sets', sortOrder: 5 },
];

const PRODUCTS: Array<{
  name: string;
  description: string;
  category: string;
  retail: number;
  wholesale: number;
  stock: number;
  tags: string[];
}> = [
  {
    name: 'Kundan Bridal Necklace Set',
    description:
      'Handcrafted kundan necklace with matching earrings and maang tikka. Gold-plated brass base with pearl drops.',
    category: 'Bridal Sets',
    retail: 4999,
    wholesale: 3250,
    stock: 12,
    tags: ['kundan', 'bridal', 'gold-plated'],
  },
  {
    name: 'Temple Jhumka Earrings',
    description:
      'Traditional South Indian temple design jhumkas with antique gold finish and ruby-red stones.',
    category: 'Earrings',
    retail: 1299,
    wholesale: 820,
    stock: 45,
    tags: ['jhumka', 'temple', 'antique'],
  },
  {
    name: 'American Diamond Choker',
    description: 'Sparkling AD choker with rhodium finish — pairs well with both saree and gown.',
    category: 'Necklaces',
    retail: 2499,
    wholesale: 1650,
    stock: 20,
    tags: ['ad', 'choker', 'party-wear'],
  },
  {
    name: 'Oxidised Silver Bangle Set (Set of 4)',
    description: 'Boho oxidised bangles with tribal motifs. Lightweight and daily-wear friendly.',
    category: 'Bangles & Bracelets',
    retail: 899,
    wholesale: 540,
    stock: 60,
    tags: ['oxidised', 'boho', 'daily-wear'],
  },
  {
    name: 'Pearl Drop Danglers',
    description: 'Freshwater-look pearl danglers on a gold-tone hook. Understated and elegant.',
    category: 'Earrings',
    retail: 749,
    wholesale: 430,
    stock: 80,
    tags: ['pearl', 'minimal'],
  },
  {
    name: 'Rose Gold Solitaire Ring',
    description: 'Rose gold-plated solitaire with a brilliant-cut AD stone. Adjustable band.',
    category: 'Rings',
    retail: 649,
    wholesale: 380,
    stock: 3,
    tags: ['rose-gold', 'solitaire', 'adjustable'],
  },
  {
    name: 'Antique Lakshmi Coin Haram',
    description: 'Long antique-finish haram with Lakshmi coin motifs — a classic festive piece.',
    category: 'Necklaces',
    retail: 3799,
    wholesale: 2450,
    stock: 8,
    tags: ['antique', 'haram', 'festive'],
  },
  {
    name: 'Meenakari Kada Pair',
    description: 'Hand-painted meenakari kadas in emerald and ruby enamel with a gold-tone base.',
    category: 'Bangles & Bracelets',
    retail: 1599,
    wholesale: 990,
    stock: 2,
    tags: ['meenakari', 'kada', 'handpainted'],
  },
];

async function seed(): Promise<void> {
  await connectDatabase();

  const categoryIds = new Map<string, string>();
  for (const entry of CATEGORIES) {
    const category = await Category.findOneAndUpdate(
      { slug: slugify(entry.name) },
      { $set: { ...entry, slug: slugify(entry.name), isActive: true } },
      { new: true, upsert: true },
    );
    categoryIds.set(entry.name, category._id.toString());
  }
  logger.info(`Seeded ${CATEGORIES.length} categories`);

  for (const entry of PRODUCTS) {
    const categoryId = categoryIds.get(entry.category);
    if (!categoryId) continue;

    await Product.findOneAndUpdate(
      { name: entry.name },
      {
        $set: {
          name: entry.name,
          description: entry.description,
          category: categoryId,
          retailPrice: rupees(entry.retail),
          wholesalePrice: rupees(entry.wholesale),
          stock: entry.stock,
          tags: entry.tags,
          isActive: true,
        },
        // Images stay empty until real Cloudinary uploads land (PRD 8.3) — the
        // app renders a placeholder for products with no image.
        $setOnInsert: { images: [] },
      },
      { upsert: true },
    );
  }
  logger.info(`Seeded ${PRODUCTS.length} products`);

  const admin = await User.findOneAndUpdate(
    { phone: env.SEED_ADMIN_PHONE },
    {
      $set: { accountType: 'admin', wholesaleStatus: 'none', isActive: true },
      $setOnInsert: { name: 'Store Admin' },
    },
    { new: true, upsert: true },
  );
  logger.info(`Admin account ready: ${admin.phone} (sign in with OTP — no password)`);

  await disconnectDatabase();
  logger.info('Seed complete.');
}

seed().catch(async (error) => {
  logger.error('Seed failed', error);
  await disconnectDatabase().catch(() => undefined);
  process.exit(1);
});
