import { Resend } from 'resend';
import { env, emailConfigured, isProduction } from '../config/env';
import { logger } from '../config/logger';

/**
 * Transactional email via Resend.
 *
 * In development the key is usually absent; rather than fail the calling flow
 * we log the message and carry on, so the password-reset journey stays
 * testable without a live account. `env.ts` refuses to boot production
 * without the key, so this fallback cannot silently swallow real mail.
 */
const resend = emailConfigured ? new Resend(env.RESEND_API_KEY) : null;

const BRAND = 'Manisha Fashions';
/** Matches the coral/rose primary used by the app's design system. */
const ACCENT = '#E5325B';

export interface SendResult {
  delivered: boolean;
  /**
   * Why the send failed, for diagnostics only.
   *
   * Callers on a request path must ignore this: forgot-password returns the
   * same generic response either way, and surfacing a provider error there
   * would reveal whether an address is registered.
   */
  error?: string;
}

export async function sendPasswordResetEmail(input: {
  to: string;
  code: string;
  expiresInMinutes: number;
}): Promise<SendResult> {
  const { to, code, expiresInMinutes } = input;
  const subject = `Reset your ${BRAND} password`;

  if (!resend) {
    // Mirrors OTP_PROVIDER=console: visible to the developer, never to a user.
    logger.warn(`[email:dev] password reset code for ${to} → ${code}`);
    return { delivered: false };
  }

  try {
    await resend.emails.send({
      from: env.RESEND_FROM_EMAIL as string,
      to,
      subject,
      text: plainTextBody(code, expiresInMinutes),
      html: htmlBody(code, expiresInMinutes),
    });
    return { delivered: true };
  } catch (error) {
    // Never surfaced to the caller: the endpoint returns the same generic
    // response either way, so a send failure cannot be used to probe for
    // registered addresses.
    logger.error('Password reset email failed to send', error);
    if (!isProduction) logger.warn(`[email:fallback] ${to} → ${code}`);
    return { delivered: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function plainTextBody(code: string, minutes: number): string {
  return [
    `${BRAND}`,
    '',
    'We received a request to reset your password.',
    '',
    'Your verification code is:',
    '',
    `    ${code}`,
    '',
    `This code expires in ${minutes} minutes and can only be used once.`,
    '',
    "If you didn't ask for this, you can ignore this email — your password stays as it is.",
  ].join('\n');
}

function htmlBody(code: string, minutes: number): string {
  // The code is spaced out and set in a monospace face so it survives being
  // read off one screen and typed into another.
  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#FBF7F4;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#2B2B2B;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;margin:0 auto;background:#FFFFFF;border-radius:14px;padding:32px;">
      <tr><td>
        <h1 style="margin:0 0 4px;font-size:20px;letter-spacing:0.02em;color:${ACCENT};">${BRAND}</h1>
        <p style="margin:0 0 24px;font-size:13px;color:#8A8A8A;">Password reset</p>
        <p style="margin:0 0 20px;font-size:15px;line-height:1.5;">Enter this code in the app to choose a new password.</p>
        <div style="margin:0 0 24px;padding:20px;background:#FBF7F4;border-radius:12px;text-align:center;">
          <span style="font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:34px;font-weight:700;letter-spacing:10px;color:${ACCENT};">${code}</span>
        </div>
        <p style="margin:0 0 8px;font-size:13px;color:#6B6B6B;">This code expires in ${minutes} minutes and can only be used once.</p>
        <p style="margin:0;font-size:13px;color:#6B6B6B;">If you didn't ask for this, you can ignore this email — your password stays as it is.</p>
      </td></tr>
    </table>
  </body>
</html>`;
}
