import { Router } from 'express';
import * as orderController from '../controllers/order.controller';

const router = Router();

/**
 * PRD 4.4 — Razorpay payment status webhook.
 *
 * Deliberately outside the JWT pipeline: Razorpay authenticates with an HMAC
 * signature over the raw body, verified in the controller. The raw body is
 * captured by the verify hook in app.ts, since re-serialising the parsed JSON
 * would change the bytes and break the signature.
 */
router.post('/razorpay', orderController.razorpayWebhook);

export default router;
