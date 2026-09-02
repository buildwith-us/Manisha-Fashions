import { cloudinary, cloudinaryConfigured } from '../config/cloudinary';
import { env } from '../config/env';
import { ApiError } from '../utils/ApiError';

/**
 * PRD 8.3 — images go to Cloudinary; only the resulting secure URL is stored on
 * the product document. Binary image data never enters MongoDB.
 */
export interface UploadedImage {
  url: string;
  publicId: string;
  width: number;
  height: number;
  format: string;
  bytes: number;
}

export async function uploadImage(file: Express.Multer.File): Promise<UploadedImage> {
  if (!cloudinaryConfigured) {
    throw ApiError.serviceUnavailable(
      'Image upload is not configured. Set the Cloudinary credentials in .env.',
    );
  }

  const result = await new Promise<Record<string, unknown>>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: env.CLOUDINARY_FOLDER,
        resource_type: 'image',
        // Auto format + quality is the "auto image optimization" the PRD relies
        // on to keep catalog images light on mobile.
        transformation: [{ quality: 'auto:good', fetch_format: 'auto' }],
      },
      (error, uploadResult) => {
        if (error || !uploadResult) {
          reject(ApiError.serviceUnavailable(error?.message ?? 'Image upload failed'));
          return;
        }
        resolve(uploadResult as unknown as Record<string, unknown>);
      },
    );
    stream.end(file.buffer);
  });

  return {
    url: result.secure_url as string,
    publicId: result.public_id as string,
    width: result.width as number,
    height: result.height as number,
    format: result.format as string,
    bytes: result.bytes as number,
  };
}

export async function deleteImage(publicId: string): Promise<void> {
  if (!cloudinaryConfigured) return;
  await cloudinary.uploader.destroy(publicId);
}
