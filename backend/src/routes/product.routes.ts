import { Router } from 'express';
import multer from 'multer';
import * as productController from '../controllers/product.controller';
import * as reviewController from '../controllers/review.controller';
import { authenticate, optionalAuthenticate } from '../middleware/authenticate';
import { allowGuestOrPermission, requirePermission } from '../middleware/authorize';
import { writeLimiter } from '../middleware/rateLimiter';
import { validate } from '../middleware/validate';
import { objectIdParam } from '../validators/common';
import {
  categoryListQuery,
  createCategorySchema,
  reviewListQuery,
  upsertReviewSchema,
  createProductSchema,
  productListQuery,
  updateCategorySchema,
  updateProductSchema,
} from '../validators/catalog.validator';
import { PERMISSIONS } from '../utils/rbac';

const router = Router();

// Images are held in memory only long enough to stream them to Cloudinary.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 10 },
  fileFilter: (_req, file, callback) => {
    if (!/^image\/(jpe?g|png|webp|avif)$/.test(file.mimetype)) {
      callback(new Error('Only JPEG, PNG, WebP or AVIF images are allowed'));
      return;
    }
    callback(null, true);
  },
});

/* ── Categories (declared before /:id so "categories" is not read as an id) ── */

// Public read: a signed-out guest browses the catalogue (guest-first entry).
// optionalAuthenticate still attaches req.user when a token is present, so an
// approved wholesale account keeps its tier; an absent viewer serializes as
// retail with wholesalePrice stripped (see product.serializer).
router.get(
  '/categories',
  validate({ query: categoryListQuery }),
  optionalAuthenticate,
  allowGuestOrPermission(PERMISSIONS.CATALOG_BROWSE),
  productController.listCategories,
);

router.post(
  '/categories',
  validate({ body: createCategorySchema }),
  writeLimiter,
  authenticate,
  requirePermission(PERMISSIONS.CATEGORY_MANAGE),
  productController.createCategory,
);

router.patch(
  '/categories/:id',
  validate({ params: objectIdParam(), body: updateCategorySchema }),
  writeLimiter,
  authenticate,
  requirePermission(PERMISSIONS.CATEGORY_MANAGE),
  productController.updateCategory,
);

router.delete(
  '/categories/:id',
  validate({ params: objectIdParam() }),
  writeLimiter,
  authenticate,
  requirePermission(PERMISSIONS.CATEGORY_MANAGE),
  productController.removeCategory,
);

/* ── Image upload (PRD 8.3) ─────────────────────────────────────────────── */

router.post(
  '/images',
  writeLimiter,
  authenticate,
  requirePermission(PERMISSIONS.PRODUCT_MANAGE),
  upload.array('images', 10),
  productController.uploadImages,
);

/* ── Reviews (PDP ratings + comments) ───────────────────────────────────── */

/**
 * Reading is open to guests so the ratings show before sign-in;
 * optionalAuthenticate still attaches the viewer so their own review can be
 * marked `mine` and offered for editing.
 */
router.get(
  '/:id/reviews',
  validate({ params: objectIdParam(), query: reviewListQuery }),
  optionalAuthenticate,
  reviewController.list,
);

/**
 * Writing requires an account that may browse the catalogue at all — which
 * excludes a pending or rejected wholesale applicant, exactly as it excludes
 * them from the products themselves.
 */
router.post(
  '/:id/reviews',
  validate({ params: objectIdParam(), body: upsertReviewSchema }),
  writeLimiter,
  authenticate,
  requirePermission(PERMISSIONS.CATALOG_BROWSE),
  reviewController.upsert,
);

router.delete(
  '/:id/reviews',
  validate({ params: objectIdParam() }),
  writeLimiter,
  authenticate,
  requirePermission(PERMISSIONS.CATALOG_BROWSE),
  reviewController.remove,
);

/* ── Catalog ────────────────────────────────────────────────────────────── */

/**
 * Browsing is open to signed-out guests (guest-first entry), who are served
 * retail pricing with wholesalePrice stripped.
 *
 * A request that carries a token is still held to catalog:browse, so a pending
 * or rejected wholesale applicant remains blocked exactly as before — PRD 4.1's
 * "blocked until approved" rule is unchanged by guest access.
 */
router.get(
  '/',
  validate({ query: productListQuery }),
  optionalAuthenticate,
  allowGuestOrPermission(PERMISSIONS.CATALOG_BROWSE),
  productController.list,
);

router.get(
  '/:id',
  validate({ params: objectIdParam() }),
  optionalAuthenticate,
  allowGuestOrPermission(PERMISSIONS.CATALOG_BROWSE),
  productController.detail,
);

router.post(
  '/',
  validate({ body: createProductSchema }),
  writeLimiter,
  authenticate,
  requirePermission(PERMISSIONS.PRODUCT_MANAGE),
  productController.create,
);

router.patch(
  '/:id',
  validate({ params: objectIdParam(), body: updateProductSchema }),
  writeLimiter,
  authenticate,
  requirePermission(PERMISSIONS.PRODUCT_MANAGE),
  productController.update,
);

router.delete(
  '/:id',
  validate({ params: objectIdParam() }),
  writeLimiter,
  authenticate,
  requirePermission(PERMISSIONS.PRODUCT_MANAGE),
  productController.remove,
);

export default router;
