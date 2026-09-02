import { Router } from 'express';
import * as orderController from '../controllers/order.controller';
import { authenticate } from '../middleware/authenticate';
import { requirePermission } from '../middleware/authorize';
import { writeLimiter } from '../middleware/rateLimiter';
import { validate } from '../middleware/validate';
import { objectIdParam, paginationQuery } from '../validators/common';
import {
  cancelOrderSchema,
  checkoutSchema,
  confirmPaymentSchema,
} from '../validators/order.validator';
import { PERMISSIONS } from '../utils/rbac';

const router = Router();

router.post(
  '/checkout',
  validate({ body: checkoutSchema }),
  writeLimiter,
  authenticate,
  requirePermission(PERMISSIONS.ORDER_CREATE),
  orderController.checkout,
);

router.post(
  '/payment/confirm',
  validate({ body: confirmPaymentSchema }),
  writeLimiter,
  authenticate,
  requirePermission(PERMISSIONS.ORDER_CREATE),
  orderController.confirmPayment,
);

router.get(
  '/',
  validate({ query: paginationQuery }),
  authenticate,
  requirePermission(PERMISSIONS.ORDER_READ_OWN),
  orderController.listMine,
);

router.get(
  '/:id',
  validate({ params: objectIdParam() }),
  authenticate,
  requirePermission(PERMISSIONS.ORDER_READ_OWN),
  orderController.detailMine,
);

// PRD 4.5 — cancellation is permitted only while the order is still "placed";
// the service enforces that, this route only enforces ownership.
router.post(
  '/:id/cancel',
  validate({ params: objectIdParam(), body: cancelOrderSchema }),
  writeLimiter,
  authenticate,
  requirePermission(PERMISSIONS.ORDER_CANCEL_OWN),
  orderController.cancelMine,
);

export default router;
