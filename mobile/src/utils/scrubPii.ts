/**
 * Removes personal data from text before an error report leaves the device.
 * Same patterns as the backend's utils/scrubPii.ts: emails, Indian mobile
 * numbers, JWTs and bearer tokens, Razorpay ids, and 6-digit numbers (reset
 * codes and PIN codes). Keys that name personal fields are redacted outright.
 */
const PATTERNS: Array<[RegExp, string]> = [
  [/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[token]'],
  [/Bearer\s+\S+/gi, 'Bearer [token]'],
  [/[^\s@"'<>(),;:]+@[^\s@"'<>(),;:]+\.[a-z]{2,}/gi, '[email]'],
  [/(?:\+?91[\s-]?)?(?<!\d)[6-9]\d{4}[\s-]?\d{5}(?!\d)/g, '[phone]'],
  [/\b(?:pay|order|rfnd)_[A-Za-z0-9]{6,}\b/g, '[razorpay-id]'],
  [/(?<!\d)\d{6}(?!\d)/g, '[6-digit]'],
];

const SENSITIVE_KEY =
  /pass(word)?|secret|token|authorization|cookie|otp|code|email|phone|address|line1|line2|pincode|fullName|name/i;

export function scrubText(value: string): string {
  let result = value;
  for (const [pattern, replacement] of PATTERNS) result = result.replace(pattern, replacement);
  return result;
}

export function scrubValue<T>(value: T, depth = 0): T {
  if (depth > 8) return '[depth]' as unknown as T;
  if (typeof value === 'string') return scrubText(value) as unknown as T;
  if (Array.isArray(value)) return value.map((entry) => scrubValue(entry, depth + 1)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEY.test(key) ? '[redacted]' : scrubValue(entry, depth + 1);
    }
    return out as T;
  }
  return value;
}

/** A URL without its query string (search terms, ids) and with text scrubbed. */
export function scrubUrl(url: string): string {
  return scrubText(url.split('?')[0]);
}
