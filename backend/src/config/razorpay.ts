import Razorpay from 'razorpay';
import { env, razorpayConfigured } from './env';
import { logger } from './logger';

let instance: Razorpay | null = null;

if (razorpayConfigured) {
  instance = new Razorpay({
    key_id: env.RAZORPAY_KEY_ID as string,
    key_secret: env.RAZORPAY_KEY_SECRET as string,
  });
  logger.info('Razorpay configured');
} else {
  logger.warn('Razorpay not configured — only COD orders can be placed.');
}

export function getRazorpay(): Razorpay | null {
  return instance;
}

export { razorpayConfigured };
