import { Schema, model, type Document, type Types } from 'mongoose';

/** PRD 4.2 — Wishlist / "Save for later". */
export interface IWishlist extends Document<Types.ObjectId> {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  productIds: Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

const wishlistSchema = new Schema<IWishlist>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    productIds: [{ type: Schema.Types.ObjectId, ref: 'Product' }],
  },
  { timestamps: true },
);

export const Wishlist = model<IWishlist>('Wishlist', wishlistSchema);
