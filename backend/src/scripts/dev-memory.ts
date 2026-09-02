/**
 * Runs the real API against an in-memory MongoDB.
 *
 * For demoing or trying the app when there is no Mongo/Docker available.
 * Data is discarded when the process exits — never use this for anything real.
 *
 * Run with: npm run dev:memory
 */
import { MongoMemoryServer } from 'mongodb-memory-server';

async function main(): Promise<void> {
  const mongod = await MongoMemoryServer.create();

  // Must be set before anything imports config/env.ts.
  process.env.NODE_ENV = 'development';
  process.env.MONGODB_URI = mongod.getUri('manisha_dev');
  process.env.OTP_PROVIDER = process.env.OTP_PROVIDER ?? 'console';
  process.env.JWT_ACCESS_SECRET =
    process.env.JWT_ACCESS_SECRET ?? 'dev-only-access-secret-0123456789abcdef';
  process.env.JWT_REFRESH_SECRET =
    process.env.JWT_REFRESH_SECRET ?? 'dev-only-refresh-secret-0123456789abcdef';

  const { createApp } = await import('../app');
  const { connectDatabase } = await import('../config/database');
  const { initStore } = await import('../config/store');
  const { env } = await import('../config/env');
  const { logger } = await import('../config/logger');

  initStore();
  await connectDatabase();

  // Reuse the seed data so the catalogue is not empty on first launch.
  const { Category, slugify } = await import('../models/category.model');
  const { Product } = await import('../models/product.model');
  const { User } = await import('../models/user.model');

  const categories = [
    { name: 'Necklaces', sortOrder: 1 },
    { name: 'Earrings', sortOrder: 2 },
    { name: 'Bangles & Bracelets', sortOrder: 3 },
    { name: 'Rings', sortOrder: 4 },
    { name: 'Bridal Sets', sortOrder: 5 },
  ];

  const ids = new Map<string, string>();
  for (const entry of categories) {
    const category = await Category.create({ ...entry, slug: slugify(entry.name) });
    ids.set(entry.name, category._id.toString());
  }

  const rupees = (amount: number) => Math.round(amount * 100);
  const products = [
    ['Kundan Bridal Necklace Set', 'Bridal Sets', 4999, 3250, 12],
    ['Temple Jhumka Earrings', 'Earrings', 1299, 820, 45],
    ['American Diamond Choker', 'Necklaces', 2499, 1650, 20],
    ['Oxidised Silver Bangle Set', 'Bangles & Bracelets', 899, 540, 60],
    ['Pearl Drop Danglers', 'Earrings', 749, 430, 80],
    ['Rose Gold Solitaire Ring', 'Rings', 649, 380, 3],
    ['Antique Lakshmi Coin Haram', 'Necklaces', 3799, 2450, 8],
    ['Meenakari Kada Pair', 'Bangles & Bracelets', 1599, 990, 2],
  ] as const;

  await Product.insertMany(
    products.map(([name, category, retail, wholesale, stock]) => ({
      name,
      description: `${name} — handcrafted piece from the Manisha Fashions collection.`,
      category: ids.get(category),
      images: [],
      retailPrice: rupees(retail),
      wholesalePrice: rupees(wholesale),
      stock,
      tags: [],
      isActive: true,
    })),
  );

  const admin = await User.create({
    phone: env.SEED_ADMIN_PHONE,
    name: 'Store Admin',
    accountType: 'admin',
  });

  const app = createApp();
  app.listen(env.PORT, () => {
    logger.info('─'.repeat(58));
    logger.info(`In-memory API ready → http://localhost:${env.PORT}${env.API_PREFIX}`);
    logger.info(`Admin sign-in phone: ${admin.phone}`);
    logger.info('OTP codes are printed here and returned as "devCode".');
    logger.info('Data is discarded on exit.');
    logger.info('─'.repeat(58));
  });

  const shutdown = async () => {
    await mongod.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((error) => {
  console.error('Failed to start the in-memory API', error);
  process.exit(1);
});
