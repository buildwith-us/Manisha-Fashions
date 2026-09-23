/**
 * Runs before any module is imported (jest `setupFiles`), because
 * config/env.ts parses process.env at import time and throws if the required
 * secrets are missing. Nothing here is a real credential.
 *
 * MONGODB_URI only has to satisfy the schema — each test file connects to its
 * own in-memory mongod and never dials this value.
 */
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/manisha_fashions_test';
process.env.JWT_ACCESS_SECRET = 'test-access-secret-at-least-16-chars';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-at-least-16-chars';

// COD defaults the checkout tests assert against: ₹50, available everywhere
// until a state says otherwise.
process.env.COD_SHIPPING_CHARGE = '5000';
process.env.COD_DEFAULT_ENABLED = 'true';
process.env.PREPAID_SHIPPING_CHARGE = '0';

// The general limiter is per-IP and every test request comes from the same
// one; the default 100/min would start returning 429 part-way through a file.
process.env.RATE_LIMIT_GENERAL_PER_MIN = '100000';
process.env.RATE_LIMIT_AUTH_PER_MIN = '100000';

// Google sign-in: the verifier is mocked in the specs, but config/env.ts still
// refuses to treat the feature as configured without an audience list.
process.env.GOOGLE_CLIENT_IDS = 'test-web-client.apps.googleusercontent.com';

// Admin is granted by this list on every sign-in. Mixed case and padding on
// purpose — the whitelist must normalise both.
process.env.ADMIN_EMAILS = ' Owner@Example.com , boss@example.com ';

// Password reset: emailed 6-digit code → short-lived token → new password.
process.env.PASSWORD_RESET_OTP_TTL_MINUTES = '10';
process.env.PASSWORD_RESET_TOKEN_TTL_MINUTES = '5';
process.env.PASSWORD_RESET_MAX_ATTEMPTS = '5';
process.env.PASSWORD_RESET_LOCKOUT_MINUTES = '10';
process.env.FORGOT_PASSWORD_MAX_PER_HOUR = '3';

// Left unset so email.service falls back to logging the code instead of
// dialling Gmail: the suite must never touch the network.
delete process.env.SMTP_USER;
delete process.env.SMTP_APP_PASSWORD;
