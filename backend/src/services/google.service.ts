import { OAuth2Client } from 'google-auth-library';
import { env, googleAuthConfigured } from '../config/env';
import { ApiError } from '../utils/ApiError';

/**
 * Server-side verification of a Google ID token (PRD 8.7).
 *
 * The client is never trusted to report who it is: the raw ID token is
 * verified against Google's public keys here, and only the decoded payload is
 * used. A token minted for somebody else's app fails the audience check.
 */
const client = new OAuth2Client();

export interface GoogleIdentity {
  googleId: string;
  email: string;
  emailVerified: boolean;
  name?: string;
}

export async function verifyGoogleIdToken(idToken: string): Promise<GoogleIdentity> {
  if (!googleAuthConfigured) {
    throw ApiError.serviceUnavailable('Google sign-in is not configured on this server.');
  }

  let payload;
  try {
    const ticket = await client.verifyIdToken({
      idToken,
      // All three platform client ids are accepted — see GOOGLE_CLIENT_IDS.
      audience: env.GOOGLE_CLIENT_IDS,
    });
    payload = ticket.getPayload();
  } catch {
    throw ApiError.unauthorized('Could not verify your Google sign-in.', 'GOOGLE_TOKEN_INVALID');
  }

  if (!payload?.sub || !payload.email) {
    throw ApiError.unauthorized('Google did not return an email address.', 'GOOGLE_TOKEN_INVALID');
  }

  // An unverified Google email must not be able to claim an existing account:
  // linking is done by email, so this is the check that stops takeover.
  if (!payload.email_verified) {
    throw ApiError.unauthorized(
      'Your Google email address is not verified.',
      'GOOGLE_EMAIL_UNVERIFIED',
    );
  }

  return {
    googleId: payload.sub,
    email: payload.email.toLowerCase(),
    emailVerified: true,
    name: payload.name,
  };
}
