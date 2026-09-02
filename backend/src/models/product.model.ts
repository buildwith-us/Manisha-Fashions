import { Schema, model, type Document, type Types } from 'mongoose';

/**
 * PRD 8.2 — Product.
 * retailPrice / wholesalePrice are integer paise. Both are required with no
 * auto-derived default (PRD 4.7): admin sets each one explicitly.
 */
export interface IProduct extends Document<Types.ObjectId> {
  _id: Types.ObjectId;
  name: string;
  description: string;
  category: Types.ObjectId;
  images: string[];
  retailPrice: number;
  wholesalePrice: number;
  stock: number;
  sku?: string;
  tags: string[];
  isActive: boolean;
  /**
   * Which storefront the product appears in (PRD 4.2 / 4.7).
   *
   * Separate from `isActive`: a hidden product is off sale entirely, whereas
   * this decides *who* sees a product that is on sale. Staff and admin always
   * see everything regardless.
   */
  visibility: 'both' | 'retail' | 'wholesale';
  createdAt: Date;
  updatedAt: Date;
}

const productSchema = new Schema<IProduct>(
  {
    name: { type: String, required: true, trim: true, maxlength: 160, index: true },
    description: { type: String, required: true, trim: true, maxlength: 4000 },
    category: { type: Schema.Types.ObjectId, ref: 'Category', required: true },
    // Cloudinary secure URLs only — never binary image data (PRD 8.3).
    images: {
      type: [String],
      default: [],
      validate: {
        validator: (value: string[]) => value.length <= 10,
        message: 'A product can have at most 10 images',
      },
    },
    retailPrice: { type: Number, required: true, min: 0 },
    wholesalePrice: { type: Number, required: true, min: 0 },
    stock: { type: Number, required: true, min: 0, default: 0 },
    sku: { type: String, trim: true, uppercase: true, sparse: true },
    tags: { type: [String], default: [], index: true },
    isActive: { type: Boolean, default: true },
    // Defaults to 'both' so every product created before this field existed
    // keeps showing in both storefronts.
    visibility: {
      type: String,
      enum: ['both', 'retail', 'wholesale'],
      default: 'both',
      required: true,
    },
  },
  { timestamps: true },
);

// Search bar — product name / keyword search (PRD 4.2).
productSchema.index({ name: 'text', description: 'text', tags: 'text' });
// Catalog browse + filter/sort paths (PRD 4.2).
productSchema.index({ isActive: 1, visibility: 1, category: 1, retailPrice: 1 });
productSchema.index({ isActive: 1, visibility: 1, createdAt: -1 });
// Low-stock dashboard widget (PRD 4.7).
productSchema.index({ stock: 1 });

export const Product = model<IProduct>('Product', productSchema);
