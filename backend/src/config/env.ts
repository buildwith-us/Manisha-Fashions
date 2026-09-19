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
  // so an automated run can lift it. The per-email reset quota in auth.service
  // is the finer-grained control and is unaffected by this value.
  RATE_LIMIT_AUTH_PER_MIN: z.coerce.number().int().positive().default(20),
  TRUST_PROXY: z.string().default('1'),

  /**
   * Emails that always hold the admin role, re-applied on every sign-in.
   *
   * The email equivalent of the phone whitelist that phone+OTP login used:
   * a fresh deployment — or a restored backup — still has a way in without a
   * manual database edit, and the role cannot be lost by an accidental change
   * on the accounts screen.
   *
   * Treat this as a credential. Anyone who can sign in as a listed address
   * gets full admin: pricing, every account, every order.
   */
  ADMIN_EMAILS: z.string().default('').transform(csv),

  // ── Seed / bootstrap admin ──
  // Phone+OTP login was removed, so the first admin needs an email credential
  // or the admin panel is unreachable on a fresh database.
  SEED_ADMIN_EMAIL: z.string().email().default('admin@manishafashions.in'),
  SEED_ADMIN_PASSWORD: z.string().min(8).default('ChangeMe123'),

  // ── Google Sign-In ──
  /**
   * Accepted `aud` values for a Google ID token, comma-separated.
   *
   * Deliberately plural: the Android, iOS and Web OAuth clients each mint
   * tokens carrying their *own* client id, so a single value would reject
   * sign-ins from two of the three platforms. `verifyIdToken` takes the list.
   */
  GOOGLE_CLIENT_IDS: z.string().default('').transform(csv),

  // ── Transactional email (Gmail SMTP via nodemailer) ──
  SMTP_USER: blankable(z.string().email('SMTP_USER must be an email address').optional()),
  /**
   * A Gmail *App Password* (16 characters, usually shown in four groups),
   * never the account login password. Requires 2-Step Verification on the
   * account. Spaces are tolerated — Google displays it with them.
   */
  SMTP_APP_PASSWORD: blankable(z.string().optional()),

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
export const emailConfigured = Boolean(env.SMTP_USER && env.SMTP_APP_PASSWORD);

/**
 * Features that may run degraded in development but must never ship half-configured.
 *
 * Google sign-in without client ids would accept no token at all, and password
 * reset without SMTP would silently drop the email while still telling the
 * user one was sent — a worse failure than refusing to boot.
 */
if (isProduction) {
  const missing: string[] = [];
  if (!googleAuthConfigured) missing.push('GOOGLE_CLIENT_IDS');
  if (!env.SMTP_USER) missing.push('SMTP_USER');
  if (!env.SMTP_APP_PASSWORD) missing.push('SMTP_APP_PASSWORD');
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
