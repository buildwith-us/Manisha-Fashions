/**
 * Sends one real password-reset email, to check Resend is wired up correctly
 * before any customer depends on it.
 *
 * The key is read from .env — never passed on the command line, where it would
 * land in shell history and in the process list.
 *
 *   npm run email:test -- you@example.com
 */
import { env, emailConfigured } from '../config/env';
import { sendPasswordResetEmail } from '../services/email.service';

const SHARED_TEST_SENDER = 'onboarding@resend.dev';

function fail(message: string, hint?: string): never {
  console.error(`\n✗ ${message}`);
  if (hint) console.error(`\n${hint}`);
  console.error('');
  process.exit(1);
}

async function main(): Promise<void> {
  const to = process.argv[2];

  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    fail(
      'Pass the recipient address.',
      'Usage:\n  npm run email:test -- you@example.com',
    );
  }

  if (!emailConfigured) {
    const missing = [
      !env.RESEND_API_KEY && 'RESEND_API_KEY',
      !env.RESEND_FROM_EMAIL && 'RESEND_FROM_EMAIL',
    ].filter(Boolean);
    fail(
      `Resend is not configured — missing ${missing.join(' and ')}.`,
      `Set them in backend/.env:\n` +
        `  RESEND_API_KEY=re_...\n` +
        `  RESEND_FROM_EMAIL=noreply@yourdomain.com`,
    );
  }

  console.log(`\nFrom: ${env.RESEND_FROM_EMAIL}`);
  console.log(`To:   ${to}`);

  if (env.RESEND_FROM_EMAIL === SHARED_TEST_SENDER) {
    // Resend's shared sender only reaches the account owner's own inbox, so a
    // send to anyone else fails — and in the real flow that failure is silent.
    console.warn(
      `\n⚠ ${SHARED_TEST_SENDER} only delivers to the address that owns the\n` +
        `  Resend account. Every other recipient is rejected, so password\n` +
        `  resets would silently fail for real customers. Verify a domain and\n` +
        `  use an address on it before going live.`,
    );
  }

  // The genuine template and code path, not a throwaway "hello" — so what
  // arrives is exactly what a customer would receive.
  const result = await sendPasswordResetEmail({
    to,
    code: '123456',
    expiresInMinutes: env.PASSWORD_RESET_OTP_TTL_MINUTES,
  });

  if (!result.delivered) {
    fail(
      `Resend rejected the send: ${result.error ?? 'unknown error'}`,
      'Common causes: the API key was revoked, or RESEND_FROM_EMAIL is not on\n' +
        'a domain verified in Resend.',
    );
  }

  console.log('\n✓ Sent. Check the inbox (and the spam folder).');
  console.log('  The code in it is a placeholder and will not reset anything.\n');
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
