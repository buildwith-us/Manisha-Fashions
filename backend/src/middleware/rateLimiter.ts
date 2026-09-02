import rateLimit from 'express-rate-limit';
import type { Request } from 'express';
import { env } from '../config/env';

/**
 * PRD 8.6 / 8.11 — Rate Limiter stage.
 *
 * Applied to every public endpoint, not just OTP: ~100 req/min per IP
 * generally, with much tighter limits on the auth endpoints.
 *
 * Counters live in express-rate-limit's in-process store. Redis was removed
 * from this project, so they reset on restart and are per-instance — correct
 * for a single instance, but a second one would each keep its own counts.
 */
interface LimiterOptions {
  windowMs: number;
  limit: number;
  /** Retained for readability at the call sites; no longer a storage prefix. */
  prefix: string;
  message?: string;
}

/**
 * Limiters are keyed by IP, not by user. The pipeline order in PRD 8.6 is
 * fixed — rate limiting runs *before* JWT authentication — so req.user does
 * not exist yet at this stage and cannot be part of the key.
 */
export function createRateLimiter({ windowMs, limit, message }: LimiterOptions) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req: Request) => `ip:${req.ip ?? 'unknown'}`,
    message: {
      success: false,
      error: {
        code: 'RATE_LIMITED',
        message: message ?? 'Too many requests, please try again later.',
      },
    },
  });
}

/** ~100 req/min per IP across the API (PRD 8.11). */
export const generalLimiter = createRateLimiter({
  windowMs: 60_000,
  limit: env.RATE_LIMIT_GENERAL_PER_MIN,
  prefix: 'general',
});

/**
 * Tighter ceiling on auth endpoints. The precise per-phone OTP quota
 * (PRD 8.7 — max 5/hour) is enforced separately in the OTP service, keyed by
 * phone number as well as IP, so an attacker cannot rotate IPs to bypass it.
 */
export const authLimiter = createRateLimiter({
  windowMs: 60_000,
  limit: env.RATE_LIMIT_AUTH_PER_MIN,
  prefix: 'auth',
  message: 'Too many authentication attempts. Please wait a minute and try again.',
});

/** Writes are cheaper to abuse than reads; keep mutations bounded too. */
export const writeLimiter = createRateLimiter({
  windowMs: 60_000,
  limit: 60,
  prefix: 'write',
});
