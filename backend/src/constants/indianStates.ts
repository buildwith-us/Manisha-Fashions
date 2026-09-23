/**
 * The 28 states and 8 union territories, in the spelling the admin screen
 * offers and the COD configuration keys on.
 *
 * This is a *catalogue*, not a constraint: a delivery address's `state` is a
 * free-text field (see user.model.ts / auth.validator.ts), so a customer can
 * save anything that is two characters long. Nothing here validates an address.
 * It exists so the admin COD screen can list every state without the store
 * having to type them, and so a configuration row for "Tamil Nadu" is spelled
 * the same way every time it is created.
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
