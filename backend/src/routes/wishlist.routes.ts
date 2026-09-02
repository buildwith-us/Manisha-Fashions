import { Router } from 'express';
import * as cartController from '../controllers/cart.controller';
import { authenticate } from '../middleware/authenticate';
import { requirePermission } from '../middleware/authorize';
import { validate } from '../middleware/validate';
import { productIdParam } from '../validators/catalog.validator';
import { PERMISSIONS } from '../utils/rbac';

const router = Router();

router.use(authenticate, requirePermission(PERMISSIONS.WISHLIST_MANAGE));

router.get('/', cartController.getWishlist);
router.post(
  '/:productId/toggle',
  validate({ params: productIdParam }),
  cartController.toggleWishlist,
);

export default router;
