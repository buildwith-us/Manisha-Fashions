import { env } from '../config/env';
import { INDIAN_STATES } from '../constants/indianStates';
import { CodStateConfig, type ICodStateConfig } from '../models/codStateConfig.model';
import { User } from '../models/user.model';
import { ApiError } from '../utils/ApiError';
import type { PaymentMethod } from '../types';

/**
 * Cash on Delivery, per state (PRD 4.4 / 6).
 *
 * COD used to be one flat charge from COD_SHIPPING_CHARGE applied everywhere.
 * The store now decides per state whether COD is offered at all and what it
 * costs; a state with no row falls back to the env defaults, so nothing has to
 * be configured before COD works.
 *
 * Every figure here is integer paise, like the rest of the codebase.
 */

/**
 * The form a state name is matched on.
 *
 * Addresses store `state` as free text (user.model.ts: a trimmed string of 2–80
 * characters — there is no enum and no dropdown), so the same state arrives
 * spelled several ways. Folding case, punctuation and repeated whitespace
 * means "Tamil Nadu", "tamil nadu", "TAMIL  NADU" and "Tamil-Nadu" all resolve
 * to one configuration row.
 *
 * It does NOT fix typos or abbreviations: "Tamilnadu" and "TN" normalise to
 * something else entirely and fall back to the default. That is the intended
 * failure — a wrong default charge beats a crash or a silently free order —
 * but it is only fully solved by making the address state a fixed list.
 */
export function normalizeStateKey(state: string): string {
  return state
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export interface CodResolution {
  /** The state this was resolved for, as it was asked about. */
  state: string;
  codEnabled: boolean;
  /** Integer paise. Meaningless when codEnabled is false. */
  codCharge: number;
  /** 'state' when an explicit row matched; 'default' when the fallback applied. */
  source: 'state' | 'default';
}

export function codDefaults(): { codEnabled: boolean; codCharge: number } {
  return { codEnabled: env.COD_DEFAULT_ENABLED, codCharge: env.COD_SHIPPING_CHARGE };
}

/**
 * The COD rules that apply to a delivery address in this state.
 *
 * A missing, blank or unrecognised state resolves to the defaults rather than
 * throwing: checkout must still reach a price for an address typed by hand.
 */
export async function resolveCodForState(state: string | null | undefined): Promise<CodResolution> {
  const defaults = codDefaults();
  const key = normalizeStateKey(state ?? '');
  if (!key) return { state: state ?? '', ...defaults, source: 'default' };

  const config = await CodStateConfig.findOne({ stateKey: key });
  if (!config) return { state: state ?? '', ...defaults, source: 'default' };

  return {
    state: config.state,
    codEnabled: config.codEnabled,
    codCharge: config.codCharge,
    source: 'state',
  };
}

/**
 * The shipping charge for an order, and the COD decision behind it.
 *
 * This is the only place checkout gets a shipping figure. The client sends a
 * payment method and an address id and nothing else — no charge, no state, no
 * total — so there is no field to tamper with: the state is read from the
 * saved address server-side and the charge from the configuration.
 *
 * Throws when COD is switched off for the state, which leaves Razorpay as the
 * remaining option rather than failing the order outright.
 */
export async function resolveShipping(
  paymentMethod: PaymentMethod,
  state: string | null | undefined,
): Promise<{ shippingCharge: number; cod: CodResolution | null }> {
  if (paymentMethod !== 'cod') {
    return { shippingCharge: env.PREPAID_SHIPPING_CHARGE, cod: null };
  }

  const cod = await resolveCodForState(state);
  if (!cod.codEnabled) {
    throw new ApiError(
      409,
      `Cash on delivery is not available for deliveries to ${state?.trim() || 'this state'}. Please pay online instead.`,
      'COD_UNAVAILABLE',
    );
  }

  return { shippingCharge: cod.codCharge, cod };
}

/* ── Checkout-time lookup ───────────────────────────────────────────────── */

export interface CodOptionsForAddress {
  addressId: string;
  /** The state on the saved address, exactly as the customer typed it. */
  state: string;
  codEnabled: boolean;
  /** Integer paise. Only meaningful when codEnabled is true. */
  codCharge: number;
  prepaidShippingCharge: number;
  /**
   * True when no row matched this state and the defaults applied — usually a
   * state the store has not configured, occasionally one typed unusually.
   */
  usingDefault: boolean;
}

/**
 * What the checkout screen needs to price COD for one saved address.
 *
 * Keyed on the customer's *own* address id rather than a state string, so this
 * cannot be used to enumerate the store's per-state rules, and so the screen
 * asks about exactly the state the order will be priced against.
 */
export async function codOptionsForAddress(
  userId: string,
  addressId: string,
): Promise<CodOptionsForAddress> {
  const user = await User.findById(userId).select('addresses');
  if (!user) throw ApiError.notFound('Account not found');

  const address = user.addresses.id(addressId);
  if (!address) throw ApiError.notFound('Address not found');

  const cod = await resolveCodForState(address.state);
  return {
    addressId,
    state: address.state,
    codEnabled: cod.codEnabled,
    codCharge: cod.codCharge,
    prepaidShippingCharge: env.PREPAID_SHIPPING_CHARGE,
    usingDefault: cod.source === 'default',
  };
}

/* ── Admin configuration ────────────────────────────────────────────────── */

export interface SerializedCodStateConfig {
  state: string;
  codEnabled: boolean;
  /** Integer paise. */
  codCharge: number;
  /** False for a state shown only because it is in the catalogue. */
  configured: boolean;
  updatedAt?: string;
}

function serialize(config: ICodStateConfig): SerializedCodStateConfig {
  return {
    state: config.state,
    codEnabled: config.codEnabled,
    codCharge: config.codCharge,
    configured: true,
    updatedAt: config.updatedAt.toISOString(),
  };
}

export interface CodConfigListing {
  defaults: { codEnabled: boolean; codCharge: number };
  /** Only the states with an explicit row — what the store has actually set. */
  configured: SerializedCodStateConfig[];
  /**
   * Every state in the catalogue merged with its row (or the default), plus
   * any configured state that is not in the catalogue. This is what the admin
   * screen renders, so it never has to merge two lists itself.
   */
  states: SerializedCodStateConfig[];
}

export async function listStateConfigs(): Promise<CodConfigListing> {
  const defaults = codDefaults();
  const rows = await CodStateConfig.find().sort({ state: 1 });
  const byKey = new Map(rows.map((row) => [row.stateKey, row]));

  const states: SerializedCodStateConfig[] = INDIAN_STATES.map((state) => {
    const row = byKey.get(normalizeStateKey(state));
    // Keep the catalogue's spelling on an unconfigured state so the screen
    // always shows the canonical name.
    return row ? serialize(row) : { state, ...defaults, configured: false };
  });

  // A row for a state the catalogue does not list — an older spelling, or a
  // state added by hand. Hiding it would make it uneditable from the app.
  const catalogueKeys = new Set(INDIAN_STATES.map(normalizeStateKey));
  for (const row of rows) {
    if (!catalogueKeys.has(row.stateKey)) states.push(serialize(row));
  }

  states.sort((a, b) => a.state.localeCompare(b.state));

  return { defaults, configured: rows.map(serialize), states };
}

export async function upsertStateConfig(
  state: string,
  input: { codEnabled: boolean; codCharge: number },
): Promise<SerializedCodStateConfig> {
  const trimmed = state.trim();
  const stateKey = normalizeStateKey(trimmed);
  if (!stateKey) throw ApiError.badRequest('Enter a state name');

  const config = await CodStateConfig.findOneAndUpdate(
    { stateKey },
    { $set: { state: trimmed, codEnabled: input.codEnabled, codCharge: input.codCharge } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );

  return serialize(config);
}

/** Removes the override so the state falls back to the global default. */
export async function deleteStateConfig(state: string): Promise<CodResolution> {
  const stateKey = normalizeStateKey(state);
  const deleted = await CodStateConfig.findOneAndDelete({ stateKey });
  if (!deleted) throw ApiError.notFound('No COD override is set for this state');

  return { state: deleted.state, ...codDefaults(), source: 'default' };
}
