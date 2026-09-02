import { Schema, model, type Document, type Types } from 'mongoose';

/**
 * Product reviews and ratings (PDP reviews section).
 *
 * One review per customer per product — enforced by a unique compound index, so
 * a double submit fails at the database rather than relying on the read that
 * precedes it. Re-reviewing updates that row in place.
 *
 * `verifiedPurchase` is decided server-side at write time by looking for a
 * delivered order containing the product. It is never accepted from the client.
 */
export interface IReview extends Document<Types.ObjectId> {
  _id: Types.ObjectId;
  productId: Types.ObjectId;
  userId: Types.ObjectId;
  /** Whole stars, 1–5. */
  rating: number;
  comment?: string;
  verifiedPurchase: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const reviewSchema = new Schema<IReview>(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, trim: true, maxlength: 2000 },
    verifiedPurchase: { type: Boolean, default: false },
  },
  { timestamps: true },
);

// One review per customer per product.
reviewSchema.index({ productId: 1, userId: 1 }, { unique: true });
// Newest-first listing for a product.
reviewSchema.index({ productId: 1, createdAt: -1 });

export const Review = model<IReview>('Review', reviewSchema);
