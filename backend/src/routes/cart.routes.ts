import { Router } from 'express';
import * as cartController from '../controllers/cart.controller';
import { authenticate } from '../middleware/authenticate';
import { requirePermission } from '../middleware/authorize';
import { validate } from '../middleware/validate';
import { addToCartSchema, productIdParam, updateCartItemSchema } from '../validators/catalog.validator';
import { PERMISSIONS } from '../utils/rbac';

const router = Router();

router.use(authenticate, requirePermission(PERMISSIONS.CART_MANAGE));

router.get('/', cartController.getCart);
router.post('/items', validate({ body: addToCartSchema }), cartController.addItem);
router.patch(
  '/items/:productId',
  validate({ params: productIdParam, body: updateCartItemSchema }),
  cartController.updateItem,
);
router.delete(
  '/items/:productId',
  validate({ params: productIdParam }),
  cartController.removeItem,
);
router.delete('/', cartController.clear);

export default router;
