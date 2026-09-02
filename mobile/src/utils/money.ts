/**
 * Every monetary value from the API is an integer number of paise (₹1 = 100).
 * Formatting happens here so no screen does its own arithmetic on money.
 */

const formatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

export function formatPaise(paise: number): string {
  return formatter.format(paise / 100);
}

/** Rupees typed into an admin form → paise for the API. */
export function rupeesToPaise(rupees: string | number): number {
  const value = typeof rupees === 'string' ? Number.parseFloat(rupees) : rupees;
  if (Number.isNaN(value)) return 0;
  return Math.round(value * 100);
}

/** Paise from the API → a plain rupee string for an editable form field. */
export function paiseToRupeeInput(paise: number): string {
  return (paise / 100).toString();
}
