import { Schema, model, type Document, type Types } from 'mongoose';

/**
 * Per-state Cash-on-Delivery rules (PRD 6 — commerce settings, admin-tunable).
 *
 * One document per state. A state with no document falls back to the global
 * default (COD_DEFAULT_ENABLED / COD_SHIPPING_CHARGE), so COD works on a fresh
 * database without the store configuring 36 rows first.
 */
export interface ICodStateConfig extends Document<Types.ObjectId> {
  _id: Types.ObjectId;
  /** The state as the admin entered it — what gets shown back on the screen. */
  state: string;
  /**
   * The lookup key: `state` normalised (see cod.service.normalizeStateKey).
   *
   * Delivery addresses store `state` as free text, so "Tamil Nadu", "tamil
   * nadu" and "Tamil  Nadu" all reach checkout. Keying on the normalised form
   * means one row covers all three rather than only the spelling the admin
   * happened to use.
   */
  stateKey: string;
  codEnabled: boolean;
  /** Integer paise, like every other monetary field in this codebase. */
  codCharge: number;
  createdAt: Date;
  updatedAt: Date;
}

const codStateConfigSchema = new Schema<ICodStateConfig>(
  {
    state: { type: String, required: true, trim: true, maxlength: 80 },
    stateKey: { type: String, required: true, unique: true, trim: true, maxlength: 80 },
    codEnabled: { type: Boolean, required: true, default: true },
    codCharge: { type: Number, required: true, min: 0, default: 0 },
  },
  { timestamps: true },
);

export const CodStateConfig = model<ICodStateConfig>('CodStateConfig', codStateConfigSchema);
