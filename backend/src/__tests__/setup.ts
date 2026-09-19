/**
 * Env must be in place before anything imports config/env.ts, which parses
 * process.env at module load and throws on anything missing.
 */
process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET = 'test-access-secret-0123456789abcdef';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-0123456789abcdef';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/placeholder';
process.env.GOOGLE_CLIENT_IDS = 'test-web-client.apps.googleusercontent.com';
// Mixed case and padding on purpose: the whitelist must normalise both.
process.env.ADMIN_EMAILS = ' Owner@Example.com , boss@example.com ';
process.env.FORGOT_PASSWORD_MAX_PER_HOUR = '3';
// The per-IP auth limiter would otherwise fire first and mask the assertions:
// every test request comes from the same address. The forgot-password quota
// under test is the per-email/IP one in the service, which this does not touch.
process.env.RATE_LIMIT_AUTH_PER_MIN = '10000';
process.env.RATE_LIMIT_GENERAL_PER_MIN = '10000';
process.env.PASSWORD_RESET_OTP_TTL_MINUTES = '10';
process.env.PASSWORD_RESET_TOKEN_TTL_MINUTES = '5';
process.env.PASSWORD_RESET_MAX_ATTEMPTS = '5';
process.env.PASSWORD_RESET_LOCKOUT_MINUTES = '10';
// Left unset on purpose: email.service falls back to logging, so no network.
delete process.env.SMTP_USER;
delete process.env.SMTP_APP_PASSWORD;
