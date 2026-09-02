import { Router } from 'express';
import * as authController from '../controllers/auth.controller';
import { authenticate } from '../middleware/authenticate';
import { authLimiter } from '../middleware/rateLimiter';
import { validate } from '../middleware/validate';
import { objectIdParam } from '../validators/common';
import {
  addressSchema,
  addressUpdateSchema,
  applyWholesaleSchema,
  logoutSchema,
  refreshSchema,
  sendOtpSchema,
  updateProfileSchema,
  verifyOtpSchema,
} from '../validators/auth.validator';

const router = Router();

/**
 * Middleware order on every route below matches PRD 8.6:
 *   validate → rate limit → authenticate → authorize → controller
 */

// ── Public (PRD 8.7) ──
router.post('/otp/send', validate({ body: sendOtpSchema }), authLimiter, authController.sendOtp);
router.post('/otp/verify', validate({ body: verifyOtpSchema }), authLimiter, authController.verifyOtp);
router.post('/refresh', validate({ body: refreshSchema }), authLimiter, authController.refresh);
router.post('/logout', validate({ body: logoutSchema }), authController.logout);

// ── Authenticated ──
router.get('/me', authenticate, authController.me);
router.patch('/me', validate({ body: updateProfileSchema }), authenticate, authController.updateProfile);
router.post(
  '/wholesale/apply',
  validate({ body: applyWholesaleSchema }),
  authenticate,
  authController.applyForWholesale,
);

// ── Addresses (PRD 4.3) ──
router.get('/addresses', authenticate, authController.listAddresses);
router.post('/addresses', validate({ body: addressSchema }), authenticate, authController.addAddress);
router.patch(
  '/addresses/:id',
  validate({ params: objectIdParam(), body: addressUpdateSchema }),
  authenticate,
  authController.updateAddress,
);
router.delete(
  '/addresses/:id',
  validate({ params: objectIdParam() }),
  authenticate,
  authController.deleteAddress,
);


export default router;
