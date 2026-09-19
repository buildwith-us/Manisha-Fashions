import path from 'path';
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

/**
 * Fail-fast environment parsing. PRD 8.11 keeps every secret in .env; this
 * schema is the single place that decides what is required to boot.
 */
/**
 * `KEY=` in a .env file arrives as an empty string, not as absent. `.optional()`
 * only accepts `undefined`, so a blank line on a validated field (an email, a
 * URL) fails the whole parse and the server refuses to boot — which is exactly
 * what .env.example produces on a fresh copy. Normalise blanks to undefined.
 */
const blankable = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema);

const csv = (value: string) =>
  value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  API_PREFIX: z.string().default('/api/v1'),

  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),

  JWT_ACCESS_SECRET: z.string().min(16, 'JWT_ACCESS_SECRET must be a long random value'),
  JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET must be a long random value'),
  JWT_ACCESS_TTL: z.string().default('30m'),
  JWT_REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(90),

  OTP_PROVIDER: z.enum(['console', 'msg91']).default('console'),
  /**
   * ⚠️ TEST NUMBERS — the only phones allowed to use the console OTP provider
   * in production, and the only ones whose code is returned in the API
   * response. Everyone else is refused until a real SMS provider is set up.
   *
   * Anyone who knows a number on this list can sign in as it, so keep it to
   * handsets you control and empty it once MSG91 is live. Comma-separated,
   * E.164 or bare 10-digit; overrides the built-in default when set.
   */
  OTP_TEST_PHONES: z.string().default('').transform(csv),
  OTP_LENGTH: z.coerce.number().int().min(4).max(8).default(6),
  OTP_TTL_SECONDS: z.coerce.number().int().positive().default(600),
  OTP_MAX_SEND_PER_HOUR: z.coerce.number().int().positive().default(5),
  OTP_MAX_VERIFY_ATTEMPTS: z.coerce.number().int().positive().default(5),
  OTP_LOCKOUT_SECONDS: z.coerce.number().int().positive().default(900),
  MSG91_AUTH_KEY: z.string().optional(),
  MSG91_SENDER_ID: z.string().optional(),
  MSG91_TEMPLATE_ID: z.string().optional(),

  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),
  CLOUDINARY_FOLDER: z.string().default('manisha-fashions/products'),

  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),

  COD_SHIPPING_CHARGE: z.coerce.number().int().nonnegative().default(5000),
  PREPAID_SHIPPING_CHARGE: z.coerce.number().int().nonnegative().default(0),
  CURRENCY: z.string().default('INR'),

  CORS_ORIGINS: z.string().default('').transform(csv),
  RATE_LIMIT_GENERAL_PER_MIN: z.coerce.number().int().positive().default(100),
  // Auth endpoints keep a tighter ceiling than the rest of the API. Overridable
  // so an automated run can lift it; the per-phone OTP quota in the OTP service
  // is the real abuse control and is unaffected by this value.
  RATE_LIMIT_AUTH_PER_MIN: z.coerce.number().int().positive().default(20),
  TRUST_PROXY: z.string().default('1'),

  SEED_ADMIN_PHONE: z.string().default('+919999999999'),

  // ── Google Sign-In ──
  /**
   * Accepted `aud` values for a Google ID token, comma-separated.
   *
   * Deliberately plural: the Android, iOS and Web OAuth clients each mint
   * tokens carrying their *own* client id, so a single value would reject
   * sign-ins from two of the three platforms. `verifyIdToken` takes the list.
   */
  GOOGLE_CLIENT_IDS: z.string().default('').transform(csv),

  // ── Transactional email (Resend) ──
  RESEND_API_KEY: blankable(z.string().optional()),
  RESEND_FROM_EMAIL: blankable(
    z.string().email('RESEND_FROM_EMAIL must be an email address').optional(),
  ),

  // ── Password reset (email OTP → short-lived token → new password) ──
  /** How long the emailed 6-digit code stays valid. */
  PASSWORD_RESET_OTP_TTL_MINUTES: z.coerce.number().int().positive().default(10),
  /**
   * Life of the token minted once the code is verified. Deliberately short:
   * it is only carried from the OTP screen to the new-password screen.
   */
  PASSWORD_RESET_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().default(5),
  /** Wrong codes tolerated per email before the lockout below. */
  PASSWORD_RESET_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  PASSWORD_RESET_LOCKOUT_MINUTES: z.coerce.number().int().positive().default(10),
  /** Per email *and* per IP, enforced in the reset service (PRD 8.11). */
  FORGOT_PASSWORD_MAX_PER_HOUR: z.coerce.number().int().positive().default(3),
  /** Custom URL scheme the reset deep link targets; matches mobile/app.json. */
  APP_DEEP_LINK_SCHEME: z.string().default('manishafashions'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  // Boot-time failure: no point starting a server that cannot reach its stores.
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

export const env = parsed.data;

export const isProduction = env.NODE_ENV === 'production';
export const isDevelopment = env.NODE_ENV === 'development';

export const googleAuthConfigured = env.GOOGLE_CLIENT_IDS.length > 0;
export const emailConfigured = Boolean(env.RESEND_API_KEY && env.RESEND_FROM_EMAIL);

/**
 * Features that may run degraded in development but must never ship half-configured.
 *
 * Google sign-in without client ids would accept no token at all, and password
 * reset without Resend would silently drop the email while still telling the
 * user one was sent — a worse failure than refusing to boot.
 */
if (isProduction) {
  const missing: string[] = [];
  if (!googleAuthConfigured) missing.push('GOOGLE_CLIENT_IDS');
  if (!env.RESEND_API_KEY) missing.push('RESEND_API_KEY');
  if (!env.RESEND_FROM_EMAIL) missing.push('RESEND_FROM_EMAIL');
  if (missing.length > 0) {
    throw new Error(
      `Invalid environment configuration: ${missing.join(', ')} must be set in production.`,
    );
  }
}

export const razorpayConfigured = Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET);
export const cloudinaryConfigured = Boolean(
  env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET,
);
