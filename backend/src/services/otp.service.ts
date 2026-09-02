import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { env, isProduction } from '../config/env';
import { logger } from '../config/logger';
import { getStore } from '../config/store';
import { ApiError } from '../utils/ApiError';

/**
 * PRD 8.7 — OTP send/verify.
 *
 * The OTP is never stored in plaintext: a bcrypt hash goes into the key-value store with a
 * short TTL. Sends are capped per phone number (and separately per IP by the
 * route's rate limiter) to prevent SMS-bombing, and repeated wrong attempts
 * trigger a temporary lockout on that number.
 */

/**
 * ⚠️ TEST NUMBERS — REMOVE ONCE MSG91 IS LIVE.
 *
 * The console provider returns the OTP in the API response, so allowing it in
 * production would let anyone sign in as any number. These specific handsets
 * are exempted so the deployed app can be tested before SMS is wired up;
 * every other number is still refused.
 *
 * Anyone who knows a number on this list can sign in as it. Keep it to phones
 * you control, and empty OTP_TEST_PHONES once real SMS works.
 */
const DEFAULT_TEST_PHONES = [
  // The shop's own handsets. These are also in ALWAYS_ADMIN_PHONES
  // (auth.service.ts), so they always sign in as admin.
  '+919363750806',
  '+919345548984',

  // Customer-side testing. Deliberately NOT admin, so the retail and wholesale
  // experience can be checked on a real device. No SIM is needed: the console
  // provider returns the code in the response and the app fills it in.
  '+919000000001', // stays retail
  '+919000000002', // use the Wholesale tab at sign-up to test approval
];

const TEST_PHONES: readonly string[] = (
  env.OTP_TEST_PHONES.length > 0 ? env.OTP_TEST_PHONES : DEFAULT_TEST_PHONES
).map((entry) => `+91${entry.replace(/\D/g, '').slice(-10)}`);

/** True when this number may use the console provider in production. */
function isTestPhone(phone: string): boolean {
  return TEST_PHONES.includes(`+91${phone.replace(/\D/g, '').slice(-10)}`);
}

const OTP_KEY = (phone: string) => `otp:code:${phone}`;
const SEND_COUNT_KEY = (phone: string) => `otp:sends:${phone}`;
const ATTEMPT_KEY = (phone: string) => `otp:attempts:${phone}`;
const LOCK_KEY = (phone: string) => `otp:lock:${phone}`;

function generateCode(length: number): string {
  // crypto.randomInt is uniform — Math.random is not acceptable for an auth secret.
  let code = '';
  for (let i = 0; i < length; i += 1) {
    code += crypto.randomInt(0, 10).toString();
  }
  return code;
}

async function dispatch(phone: string, code: string): Promise<void> {
  switch (env.OTP_PROVIDER) {
    case 'msg91': {
      if (!env.MSG91_AUTH_KEY || !env.MSG91_TEMPLATE_ID) {
        throw ApiError.serviceUnavailable('SMS provider is not configured.');
      }
      const url = new URL('https://control.msg91.com/api/v5/otp');
      url.searchParams.set('template_id', env.MSG91_TEMPLATE_ID);
      url.searchParams.set('mobile', phone.replace(/^\+/, ''));
      url.searchParams.set('otp', code);
      if (env.MSG91_SENDER_ID) url.searchParams.set('sender', env.MSG91_SENDER_ID);

      const response = await fetch(url, {
        method: 'POST',
        headers: { authkey: env.MSG91_AUTH_KEY, 'Content-Type': 'application/json' },
      });
      if (!response.ok) {
        const detail = await response.text();
        logger.error('MSG91 send failed', detail);
        throw ApiError.serviceUnavailable('Could not send the OTP. Please try again.');
      }
      return;
    }

    case 'console':
    default:
      // Refused in production except for the test handsets above.
      if (isProduction && !isTestPhone(phone)) {
        throw ApiError.serviceUnavailable('OTP provider is not configured for production.');
      }
      logger.info(`[DEV OTP] ${phone} → ${code}`);
  }
}

export interface SendOtpResult {
  expiresInSeconds: number;
  /** Returned only outside production so the dev client can auto-fill. */
  devCode?: string;
}

export async function sendOtp(phone: string): Promise<SendOtpResult> {
  const store = getStore();

  const locked = await store.get(LOCK_KEY(phone));
  if (locked) {
    const remaining = await store.ttl(LOCK_KEY(phone));
    throw ApiError.tooManyRequests(
      `Too many failed attempts. Try again in ${Math.max(1, Math.ceil(remaining / 60))} minute(s).`,
    );
  }

  const sends = await store.incr(SEND_COUNT_KEY(phone));
  if (sends === 1) {
    await store.expire(SEND_COUNT_KEY(phone), 3600);
  }
  if (sends > env.OTP_MAX_SEND_PER_HOUR) {
    throw ApiError.tooManyRequests(
      `You can request at most ${env.OTP_MAX_SEND_PER_HOUR} codes per hour. Please try again later.`,
    );
  }

  const code = generateCode(env.OTP_LENGTH);
  const hash = await bcrypt.hash(code, 10);

  await store.set(OTP_KEY(phone), hash, env.OTP_TTL_SECONDS);
  await store.del(ATTEMPT_KEY(phone));

  await dispatch(phone, code);

  // The code only ever leaves the server outside production, or for a test
  // handset that has no other way to receive it.
  const mayEcho = !isProduction || isTestPhone(phone);

  return {
    expiresInSeconds: env.OTP_TTL_SECONDS,
    ...(mayEcho ? { devCode: code } : {}),
  };
}

export async function verifyOtp(phone: string, code: string): Promise<void> {
  const store = getStore();

  if (await store.get(LOCK_KEY(phone))) {
    const remaining = await store.ttl(LOCK_KEY(phone));
    throw ApiError.tooManyRequests(
      `Too many failed attempts. Try again in ${Math.max(1, Math.ceil(remaining / 60))} minute(s).`,
    );
  }

  const hash = await store.get(OTP_KEY(phone));
  if (!hash) {
    // Wrong or expired OTP → 401 (PRD 8.7).
    throw ApiError.unauthorized('This code has expired. Please request a new one.', 'OTP_EXPIRED');
  }

  const matches = await bcrypt.compare(code, hash);
  if (!matches) {
    const attempts = await store.incr(ATTEMPT_KEY(phone));
    if (attempts === 1) await store.expire(ATTEMPT_KEY(phone), env.OTP_TTL_SECONDS);

    if (attempts >= env.OTP_MAX_VERIFY_ATTEMPTS) {
      await store.set(LOCK_KEY(phone), '1', env.OTP_LOCKOUT_SECONDS);
      await store.del(OTP_KEY(phone));
      await store.del(ATTEMPT_KEY(phone));
      throw ApiError.tooManyRequests(
        `Too many incorrect codes. This number is locked for ${Math.ceil(
          env.OTP_LOCKOUT_SECONDS / 60,
        )} minutes.`,
      );
    }

    const remaining = env.OTP_MAX_VERIFY_ATTEMPTS - attempts;
    throw ApiError.unauthorized(
      `Incorrect code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`,
      'OTP_INVALID',
    );
  }

  // Single-use: consume the code so a replay cannot mint a second session.
  await store.del(OTP_KEY(phone));
  await store.del(ATTEMPT_KEY(phone));
}
