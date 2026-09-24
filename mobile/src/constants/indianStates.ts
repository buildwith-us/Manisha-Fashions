/**
 * The 28 states and 8 union territories, in the spelling the admin screen
 * offers and the COD configuration keys on.
 *
 * TWO IDENTICAL COPIES: backend/src/constants/indianStates.ts and
 * mobile/src/constants/indianStates.ts (Metro cannot bundle a file from the
 * backend package). Edit one, copy it over the other —
 * backend/src/__tests__/indian-states-sync.test.ts fails until they match.
 *
 * The app's address form offers only these names. The API still accepts any
 * state text (older app versions, older addresses), so `canonicalStateName`
 * below maps the ways a state gets typed onto one of these, and COD pricing
 * and saved addresses agree on the spelling either way.
 */
export const INDIAN_STATES = [
  'Andhra Pradesh',
  'Arunachal Pradesh',
  'Assam',
  'Bihar',
  'Chhattisgarh',
  'Goa',
  'Gujarat',
  'Haryana',
  'Himachal Pradesh',
  'Jharkhand',
  'Karnataka',
  'Kerala',
  'Madhya Pradesh',
  'Maharashtra',
  'Manipur',
  'Meghalaya',
  'Mizoram',
  'Nagaland',
  'Odisha',
  'Punjab',
  'Rajasthan',
  'Sikkim',
  'Tamil Nadu',
  'Telangana',
  'Tripura',
  'Uttar Pradesh',
  'Uttarakhand',
  'West Bengal',
  'Andaman and Nicobar Islands',
  'Chandigarh',
  'Dadra and Nagar Haveli and Daman and Diu',
  'Delhi',
  'Jammu and Kashmir',
  'Ladakh',
  'Lakshadweep',
  'Puducherry',
] as const;

export type IndianState = (typeof INDIAN_STATES)[number];

/**
 * Other ways customers write a state: ISO 3166-2:IN and vehicle-registration
 * codes, and names that were official until recently. Spacing, case and
 * punctuation variants ("Tamilnadu", "tamil-nadu", "Jammu & Kashmir") need no
 * entry here — `compactStateKey` already folds those.
 */
const STATE_ALIASES: Record<string, IndianState> = {
  AP: 'Andhra Pradesh',
  AR: 'Arunachal Pradesh',
  AS: 'Assam',
  BR: 'Bihar',
  CG: 'Chhattisgarh',
  CT: 'Chhattisgarh',
  Chattisgarh: 'Chhattisgarh',
  GA: 'Goa',
  GJ: 'Gujarat',
  HR: 'Haryana',
  HP: 'Himachal Pradesh',
  JH: 'Jharkhand',
  KA: 'Karnataka',
  KL: 'Kerala',
  MP: 'Madhya Pradesh',
  MH: 'Maharashtra',
  MN: 'Manipur',
  ML: 'Meghalaya',
  MZ: 'Mizoram',
  NL: 'Nagaland',
  OD: 'Odisha',
  OR: 'Odisha',
  Orissa: 'Odisha',
  PB: 'Punjab',
  RJ: 'Rajasthan',
  SK: 'Sikkim',
  TN: 'Tamil Nadu',
  TS: 'Telangana',
  TG: 'Telangana',
  TR: 'Tripura',
  UP: 'Uttar Pradesh',
  UK: 'Uttarakhand',
  UT: 'Uttarakhand',
  Uttaranchal: 'Uttarakhand',
  WB: 'West Bengal',
  AN: 'Andaman and Nicobar Islands',
  'Andaman and Nicobar': 'Andaman and Nicobar Islands',
  CH: 'Chandigarh',
  DH: 'Dadra and Nagar Haveli and Daman and Diu',
  DN: 'Dadra and Nagar Haveli and Daman and Diu',
  DD: 'Dadra and Nagar Haveli and Daman and Diu',
  'Dadra and Nagar Haveli': 'Dadra and Nagar Haveli and Daman and Diu',
  'Daman and Diu': 'Dadra and Nagar Haveli and Daman and Diu',
  DL: 'Delhi',
  'New Delhi': 'Delhi',
  'NCT of Delhi': 'Delhi',
  JK: 'Jammu and Kashmir',
  LA: 'Ladakh',
  LD: 'Lakshadweep',
  PY: 'Puducherry',
  Pondicherry: 'Puducherry',
};

/**
 * A state name with everything but letters and digits removed, "&" read as
 * "and". Spaces go too, so "Tamilnadu" and "Tamil Nadu" meet — the spelling
 * split that sent orders to the default COD charge.
 */
export function compactStateKey(value: string): string {
  return value.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');
}

const CANONICAL_BY_KEY = new Map<string, IndianState>([
  ...INDIAN_STATES.map((state) => [compactStateKey(state), state] as const),
  ...Object.entries(STATE_ALIASES).map(([alias, state]) => [compactStateKey(alias), state] as const),
]);

/**
 * The catalogue spelling of a state as a customer or admin typed it, or null
 * when it is not recognisable as one — a typo, or a place outside India.
 */
export function canonicalStateName(value: string | null | undefined): IndianState | null {
  if (!value) return null;
  return CANONICAL_BY_KEY.get(compactStateKey(value)) ?? null;
}
