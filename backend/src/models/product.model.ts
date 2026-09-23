import { Document, Schema, model, type Types } from 'mongoose';

/**
 * PRD 8.2 — Product.
 * retailPrice / wholesalePrice are integer paise, each required only when the
 * product is sold to that tier (see `visibility`): a retail-only product has
 * no wholesale price at all. Never auto-derived (PRD 4.7) — admin sets each
 * one explicitly.
 */
export interface IProduct extends Document<Types.ObjectId> {
  _id: Types.ObjectId;
  name: string;
  description: string;
  category: Types.ObjectId;
  images: string[];
  /** Absent on a wholesale-only product. */
  retailPrice?: number;
  /** Absent on a retail-only product. */
  wholesalePrice?: number;
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

/**
 * `required` for a price the product's visibility sells at. Only decided on
 * documents (create / save): in an update query `this` is not the product, and
 * product.service checks the merged result before any update is sent.
 */
function requiredUnlessOnly(onlyTier: 'retail' | 'wholesale') {
  return function (this: unknown): boolean {
    if (!(this instanceof Document)) return false;
    return (this as IProduct).visibility !== onlyTier;
  };
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
    retailPrice: { type: Number, required: requiredUnlessOnly('wholesale'), min: 0 },
    wholesalePrice: { type: Number, required: requiredUnlessOnly('retail'), min: 0 },
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
