import { Schema, model, type Document, type Types } from 'mongoose';

export interface ICartItem {
  productId: Types.ObjectId;
  quantity: number;
  addedAt: Date;
}

export interface ICart extends Document<Types.ObjectId> {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  items: Types.DocumentArray<ICartItem & Document>;
  createdAt: Date;
  updatedAt: Date;
}

const cartItemSchema = new Schema<ICartItem>(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    quantity: { type: Number, required: true, min: 1, max: 999 },
    addedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const cartSchema = new Schema<ICart>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    items: { type: [cartItemSchema], default: [] },
  },
  { timestamps: true },
);

export const Cart = model<ICart>('Cart', cartSchema);
