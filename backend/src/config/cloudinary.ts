import { v2 as cloudinary } from 'cloudinary';
import { env, cloudinaryConfigured } from './env';
import { logger } from './logger';

/**
 * PRD 8.3 — product images live in Cloudinary, never as binary in MongoDB.
 * Only the resulting secure URL is stored on the product document.
 */
if (cloudinaryConfigured) {
  cloudinary.config({
    cloud_name: env.CLOUDINARY_CLOUD_NAME,
    api_key: env.CLOUDINARY_API_KEY,
    api_secret: env.CLOUDINARY_API_SECRET,
    secure: true,
  });
  logger.info('Cloudinary configured');
} else {
  logger.warn('Cloudinary not configured — image upload endpoints will return 503.');
}

export { cloudinary, cloudinaryConfigured };
