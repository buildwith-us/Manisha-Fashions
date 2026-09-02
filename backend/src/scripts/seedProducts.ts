/**
 * DEMO SEED — realistic jewellery catalogue for browsing and testing.
 *
 *   npm run seed:demo
 *
 * Idempotent: every document written here carries the `demo-seed` tag, and the
 * script deletes only those before re-inserting. Running it twice does not
 * duplicate, and it never touches products you created yourself.
 *
 * To clear demo data before go-live:
 *   db.products.deleteMany({ tags: 'demo-seed' })
 *
 * Nothing here changes the Product schema or any API logic — it only inserts
 * documents through the existing model. Prices are stored in paise, and every
 * wholesalePrice is set explicitly per product (never derived from retail).
 */
import { connectDatabase, disconnectDatabase } from '../config/database';
import { logger } from '../config/logger';
import { Category, slugify } from '../models/category.model';
import { Product } from '../models/product.model';

/** The tag that marks a document as demo data. Delete by this, nothing else. */
const DEMO_TAG = 'demo-seed';

/** ₹ → paise, matching how the model stores money. */
const rupees = (amount: number) => Math.round(amount * 100);

/** Stable, real, publicly reachable placeholder images (not broken links). */
const image = (seed: string) => `https://picsum.photos/seed/${seed}/800/800`;

const CATEGORIES = [
  { name: 'Rings', description: 'Everyday bands and occasion rings', sortOrder: 1 },
  { name: 'Necklaces', description: 'Chokers, haars and statement necklaces', sortOrder: 2 },
  { name: 'Earrings', description: 'Studs, jhumkas, hoops and danglers', sortOrder: 3 },
  { name: 'Bangles', description: 'Bangles, kadas and bracelets', sortOrder: 4 },
  { name: 'Chains', description: 'Gold, silver and rose-gold chains', sortOrder: 5 },
  { name: 'Pendants', description: 'Solitaire, temple and initial pendants', sortOrder: 6 },
];

interface DemoProduct {
  name: string;
  description: string;
  category: string;
  sku: string;
  /** ₹ — retail. */
  retail: number;
  /** ₹ — trade price, always strictly lower than retail. */
  wholesale: number;
  stock: number;
  tags: string[];
  isActive?: boolean;
}

/**
 * Stock is deliberately varied: most healthy, three low (1–3) to exercise the
 * low-stock dashboard alert and the "Only N left" UI, and one at zero for the
 * sold-out treatment.
 */
const PRODUCTS: DemoProduct[] = [
  {
    name: 'Ruby Temple Necklace',
    description:
      'Hand-set ruby cabochons in an antique gold temple frame, finished with pearl drops. Comes with matching jhumkas and a velvet box.',
    category: 'Necklaces',
    sku: 'MF-NK-114',
    retail: 18400,
    wholesale: 12900,
    stock: 34,
    tags: ['ruby', 'temple', 'antique', 'bridal'],
  },
  {
    name: 'Kundan Choker Set',
    description:
      'Uncut kundan stones set in gold-plated brass with a matching pair of chandbalis. Adjustable dori fastening.',
    category: 'Necklaces',
    sku: 'MF-NK-208',
    retail: 24900,
    wholesale: 17400,
    stock: 12,
    tags: ['kundan', 'choker', 'bridal'],
  },
  {
    name: 'Guttapusalu Pearl Haar',
    description:
      'South Indian guttapusalu with layered freshwater pearl clusters on an antique-finish frame. 31 g.',
    category: 'Necklaces',
    sku: 'MF-NK-330',
    retail: 43500,
    wholesale: 31200,
    stock: 4,
    tags: ['pearl', 'guttapusalu', 'antique'],
  },
  {
    name: 'Solitaire Band Ring',
    description:
      'A single brilliant-cut zirconia in a six-prong setting on a rhodium-finished band. Available in half sizes.',
    category: 'Rings',
    sku: 'MF-RG-042',
    retail: 11600,
    wholesale: 7900,
    stock: 46,
    tags: ['solitaire', 'ring', 'everyday'],
  },
  {
    name: 'Meenakari Statement Ring',
    description:
      'Hand-painted meenakari enamel in peacock blue and green, framed in gold-plated brass. Adjustable shank.',
    category: 'Rings',
    sku: 'MF-RG-077',
    retail: 3200,
    wholesale: 1950,
    stock: 61,
    tags: ['meenakari', 'enamel', 'statement'],
  },
  {
    name: 'Stackable Pearl Ring Trio',
    description:
      'Set of three slim stacking rings with seed-pearl accents. Wear together or apart. Sold as a set of three.',
    category: 'Rings',
    sku: 'MF-RG-101',
    retail: 1450,
    wholesale: 890,
    stock: 3,
    tags: ['pearl', 'stackable', 'minimal'],
  },
  {
    name: 'Pearl Drop Jhumka',
    description:
      'Classic dome jhumka with a fringe of freshwater pearl drops. Lightweight at 11 g per piece, with screw-back fastenings.',
    category: 'Earrings',
    sku: 'MF-ER-062',
    retail: 5300,
    wholesale: 3650,
    stock: 2,
    tags: ['jhumka', 'pearl', 'lightweight'],
  },
  {
    name: 'Antique Chandbali Earrings',
    description:
      'Crescent chandbalis in an oxidised antique finish with ruby-red stone accents and pearl fringe.',
    category: 'Earrings',
    sku: 'MF-ER-118',
    retail: 8900,
    wholesale: 6100,
    stock: 18,
    tags: ['chandbali', 'antique', 'oxidised'],
  },
  {
    name: 'Rose Gold Huggie Hoops',
    description:
      'Slim 14 mm huggie hoops with a rose-gold finish and hinged closure. Everyday wear, hypoallergenic posts.',
    category: 'Earrings',
    sku: 'MF-ER-205',
    retail: 2400,
    wholesale: 1490,
    stock: 88,
    tags: ['hoops', 'rose-gold', 'everyday'],
  },
  {
    name: 'Antique Gold Bangle',
    description:
      'Broad temple-motif kada with an antique gold finish. Sold singly; sizes 2.4 to 2.10 available on request.',
    category: 'Bangles',
    sku: 'MF-BN-051',
    retail: 9750,
    wholesale: 6600,
    stock: 27,
    tags: ['kada', 'temple', 'antique'],
  },
  {
    name: 'Meenakari Bangle Pair',
    description:
      'Pair of slim bangles with hand-painted meenakari detailing in ruby and emerald tones. Gold-plated brass.',
    category: 'Bangles',
    sku: 'MF-BN-090',
    retail: 4600,
    wholesale: 2980,
    stock: 35,
    tags: ['meenakari', 'bangle', 'pair'],
  },
  {
    name: 'Rose Gold Link Chain',
    description:
      '22-inch flat-link chain, 18kt rose-gold plated over brass, 14 g. Lobster clasp with a stamped tag.',
    category: 'Chains',
    sku: 'MF-CH-201',
    retail: 7250,
    wholesale: 5100,
    stock: 52,
    tags: ['chain', 'rose-gold', 'everyday'],
  },
  {
    name: 'Sterling Box Chain',
    description:
      '20-inch sterling silver box chain, 9 g, with a rhodium finish to resist tarnish. Suits most pendants.',
    category: 'Chains',
    sku: 'MF-CH-118',
    retail: 4150,
    wholesale: 2700,
    stock: 1,
    tags: ['chain', 'silver', 'sterling'],
  },
  {
    name: 'Layered Coin Chain',
    description:
      'Double-layer chain with antique coin charms on a gold-plated brass base. Adjustable 16–18 inch length.',
    category: 'Chains',
    sku: 'MF-CH-140',
    retail: 3600,
    wholesale: 2250,
    stock: 0,
    tags: ['chain', 'layered', 'coin'],
  },
  {
    name: 'Temple Lakshmi Pendant',
    description:
      'Cast Lakshmi motif pendant in an antique gold finish with a ruby-red stone surround. Chain sold separately.',
    category: 'Pendants',
    sku: 'MF-PD-014',
    retail: 6800,
    wholesale: 4400,
    stock: 21,
    tags: ['pendant', 'temple', 'lakshmi'],
  },
];

async function seedDemoProducts(): Promise<void> {
  await connectDatabase();

  // 1. Categories the demo products hang off. Upserted by slug, so re-running
  //    reuses them and any products you created keep their category.
  const categoryIds = new Map<string, string>();
  for (const entry of CATEGORIES) {
    const slug = slugify(entry.name);
    const category = await Category.findOneAndUpdate(
      { slug },
      { $set: { ...entry, slug, isActive: true } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    categoryIds.set(entry.name, category._id.toString());
  }

  // 2. Remove ONLY previously demo-seeded products. Never the whole collection.
  const removed = await Product.deleteMany({ tags: DEMO_TAG });

  // 3. Insert fresh demo documents.
  const docs = PRODUCTS.map((entry) => {
    const categoryId = categoryIds.get(entry.category);
    if (!categoryId) throw new Error(`Unknown demo category: ${entry.category}`);

    if (entry.wholesale >= entry.retail) {
      // Guards the two-tier rule at seed time rather than shipping bad data.
      throw new Error(
        `${entry.name}: wholesale (${entry.wholesale}) must be lower than retail (${entry.retail})`,
      );
    }

    return {
      name: entry.name,
      description: entry.description,
      category: categoryId,
      images: [image(entry.sku.toLowerCase()), image(`${entry.sku.toLowerCase()}-b`)],
      retailPrice: rupees(entry.retail),
      wholesalePrice: rupees(entry.wholesale),
      stock: entry.stock,
      sku: entry.sku,
      tags: [...entry.tags, DEMO_TAG],
      isActive: entry.isActive ?? true,
    };
  });

  const inserted = await Product.insertMany(docs);

  // 4. Report.
  const total = await Product.countDocuments();
  const demoCount = await Product.countDocuments({ tags: DEMO_TAG });
  const sample = await Product.findOne({ tags: DEMO_TAG }).populate('category');

  logger.info('─'.repeat(60));
  logger.info(`Demo seed complete`);
  logger.info(`  removed previous demo products : ${removed.deletedCount}`);
  logger.info(`  inserted                       : ${inserted.length}`);
  logger.info(`  demo products now              : ${demoCount}`);
  logger.info(`  products in collection (all)   : ${total}`);
  logger.info(`  low stock (<= 3)               : ${await Product.countDocuments({ tags: DEMO_TAG, stock: { $lte: 3 } })}`);
  logger.info(`  out of stock                   : ${await Product.countDocuments({ tags: DEMO_TAG, stock: 0 })}`);
  logger.info('─'.repeat(60));
  logger.info('Sample document:');
  logger.info(JSON.stringify(sample?.toObject(), null, 2));
  logger.info('─'.repeat(60));

  await disconnectDatabase();
}

seedDemoProducts()
  .then(() => process.exit(0))
  .catch((error) => {
    logger.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
