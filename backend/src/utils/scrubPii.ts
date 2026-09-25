/**
 * Removes personal data from text before it leaves the server (error
 * reports). Errors are the risk: a message can quote an email, a validation
 * failure can echo a phone number, a stack can carry a token.
 *
 * Redacts emails, Indian mobile numbers, JWTs and bearer tokens, Razorpay ids,
 * and 6-digit numbers (reset codes and PIN codes). Addresses cannot be matched
 * reliably by pattern, so the event scrubber never sends request bodies at
 * all — that is where addresses would be.
 */
const PATTERNS: Array<[RegExp, string]> = [
  [/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[token]'],
  [/Bearer\s+\S+/gi, 'Bearer [token]'],
  [/[^\s@"'<>(),;:]+@[^\s@"'<>(),;:]+\.[a-z]{2,}/gi, '[email]'],
  // Also the common "98765 43210" / "98765-43210" grouping.
  [/(?:\+?91[\s-]?)?(?<!\d)[6-9]\d{4}[\s-]?\d{5}(?!\d)/g, '[phone]'],
  [/\b(?:pay|order|rfnd)_[A-Za-z0-9]{6,}\b/g, '[razorpay-id]'],
  [/(?<!\d)\d{6}(?!\d)/g, '[6-digit]'],
];

export function scrubText(value: string): string {
  let result = value;
  for (const [pattern, replacement] of PATTERNS) result = result.replace(pattern, replacement);
  return result;
}

/** Deep-scrubs strings inside any JSON-like value; drops known-sensitive keys. */
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

const SENSITIVE_KEY =
  /pass(word)?|secret|token|authorization|cookie|otp|code|email|phone|address|line1|line2|pincode|fullName|name/i;
