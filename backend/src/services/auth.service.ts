import { User, type IUser } from '../models/user.model';
import { ApiError } from '../utils/ApiError';
import { serializeUser, type SerializedUser } from '../serializers/user.serializer';
import { env } from '../config/env';
import { getStore } from '../config/store';
import * as emailService from './email.service';
import * as googleService from './google.service';
import * as otpService from './otp.service';
import * as passwordService from './password.service';
import * as tokenService from './token.service';

/**
 * Numbers that always hold the admin role, re-applied on every sign-in.
 *
 * Keeping the shop's own phones here rather than only in the database means a
 * fresh deployment — or a restored backup — still has a way in without a manual
 * database edit, and the role cannot be lost by an accidental change on the
 * accounts screen.
 *
 * Stored in E.164 to match the normalised number `verifyOtpAndLogin` receives.
 *
 * Treat this list as a credential: anyone who can receive an OTP on one of
 * these numbers gets full admin — pricing, every account, every order. Remove a
 * number the moment the SIM changes hands.
 */
const ALWAYS_ADMIN_PHONES: readonly string[] = ['+919363750806', '+919345548984'];

function isAlwaysAdmin(phone: string): boolean {
  return ALWAYS_ADMIN_PHONES.includes(phone);
}

export interface LoginContext {
  deviceId?: string;
  userAgent?: string;
}

export interface WholesaleApplication {
  businessName?: string;
  gstNumber?: string;
  shopProofUrl?: string;
}

export interface AuthResult {
  user: SerializedUser;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresIn: number;
  refreshTokenExpiresAt: string;
}

export async function requestOtp(phone: string) {
  return otpService.sendOtp(phone);
}

/**
 * PRD 8.7 — on a correct OTP: find or create the user, then issue the access +
 * refresh pair. This is the only place an account is created; there is no
 * password anywhere in the system.
 */
export async function verifyOtpAndLogin(input: {
  phone: string;
  code: string;
  /** Only meaningful on first signup — an existing account's role is never changed by the client. */
  accountType?: 'retail' | 'wholesale';
  application?: WholesaleApplication;
  context?: LoginContext;
}): Promise<AuthResult> {
  const { phone, code, accountType = 'retail', application, context = {} } = input;

  await otpService.verifyOtp(phone, code);

  let user = await User.findOne({ phone });

  // A hardcoded admin number is admin no matter what the client asked for.
  const forcedAdmin = isAlwaysAdmin(phone);

  if (!user) {
    user = await User.create({
      phone,
      accountType: forcedAdmin ? 'admin' : accountType,
      // A wholesale signup starts pending and stays blocked until an admin
      // approves it — this is what stops retail users self-selecting the
      // discounted tier (PRD 4.1).
      wholesaleStatus: !forcedAdmin && accountType === 'wholesale' ? 'pending' : 'none',
      ...(!forcedAdmin && accountType === 'wholesale'
        ? { business: { ...application, appliedAt: new Date() } }
        : {}),
      lastLoginAt: new Date(),
    });
  } else {
    if (!user.isActive) {
      throw ApiError.forbidden('This account has been deactivated. Please contact support.');
    }

    // Re-applied on every sign-in, so a number added to the list later is
    // promoted the next time it logs in, and a demotion made by mistake in the
    // accounts screen cannot lock the shop out. Runs before the wholesale
    // branch below so `canApply` sees the admin role and leaves it alone.
    if (forcedAdmin && user.accountType !== 'admin') {
      user.accountType = 'admin';
      user.wholesaleStatus = 'none';
    }

    // An existing retail customer may apply for wholesale; a rejected applicant
    // may re-apply (PRD 4.1). Admin and staff roles are never client-assignable.
    const canApply =
      accountType === 'wholesale' &&
      user.accountType !== 'admin' &&
      user.accountType !== 'staff' &&
      (user.wholesaleStatus === 'none' || user.wholesaleStatus === 'rejected');

    if (canApply) {
      user.accountType = 'wholesale';
      user.wholesaleStatus = 'pending';
      user.business = { ...(user.business ?? {}), ...application, appliedAt: new Date() };
      user.wholesaleReview = undefined;
    }

    user.lastLoginAt = new Date();
    await user.save();
  }

  const tokens = await tokenService.issueTokens(user, context);

  return {
    user: serializeUser(user),
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    accessTokenExpiresIn: tokens.accessTokenExpiresIn,
    refreshTokenExpiresAt: tokens.refreshTokenExpiresAt.toISOString(),
  };
}

export async function refreshSession(
  refreshToken: string,
  context: LoginContext = {},
): Promise<AuthResult> {
  const { tokens, userId } = await tokenService.rotateRefreshToken(refreshToken, context);
  const user = await User.findById(userId);
  if (!user) throw ApiError.unauthorized('Account not found', 'ACCOUNT_NOT_FOUND');

  return {
    user: serializeUser(user),
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    accessTokenExpiresIn: tokens.accessTokenExpiresIn,
    refreshTokenExpiresAt: tokens.refreshTokenExpiresAt.toISOString(),
  };
}

export async function logout(refreshToken: string): Promise<void> {
  await tokenService.revokeRefreshToken(refreshToken);
}

export async function getProfile(userId: string): Promise<SerializedUser> {
  const user = await User.findById(userId);
  if (!user) throw ApiError.notFound('Account not found');
  return serializeUser(user);
}

export async function updateProfile(
  userId: string,
  updates: { name?: string; email?: string },
): Promise<SerializedUser> {
  const user = await User.findByIdAndUpdate(userId, { $set: updates }, { new: true });
  if (!user) throw ApiError.notFound('Account not found');
  return serializeUser(user);
}

/** Lets an already-signed-in retail customer apply for a wholesale account. */
export async function applyForWholesale(
  userId: string,
  application: WholesaleApplication,
): Promise<SerializedUser> {
  const user = await User.findById(userId);
  if (!user) throw ApiError.notFound('Account not found');

  if (user.accountType === 'admin' || user.accountType === 'staff') {
    throw ApiError.badRequest('Staff accounts cannot apply for wholesale pricing.');
  }
  if (user.wholesaleStatus === 'pending') {
    throw ApiError.conflict('Your wholesale application is already under review.');
  }
  if (user.wholesaleStatus === 'approved') {
    throw ApiError.conflict('Your wholesale account is already approved.');
  }

  user.accountType = 'wholesale';
  user.wholesaleStatus = 'pending';
  user.business = { ...(user.business ?? {}), ...application, appliedAt: new Date() };
  user.wholesaleReview = undefined;
  await user.save();

  return serializeUser(user);
}

export async function findUserById(userId: string): Promise<IUser> {
  const user = await User.findById(userId);
  if (!user) throw ApiError.notFound('Account not found');
  return user;
}

// ─────────────────────────────────────────────────────────────
// Password + Google credentials
//
// These sit alongside the OTP flow rather than replacing it: an account may
// carry any combination of the three, tracked in `authProviders`.
// ─────────────────────────────────────────────────────────────

/**
 * A bcrypt hash of a throwaway value, compared against when no account
 * matches, so a failed login costs the same time whether the email exists or
 * not. Without it, response latency alone enumerates registered addresses.
 */
const DUMMY_HASH = '$2a$12$C6UzMDM.H6dfI/f/IKcEe.e/qR2Vn3xYQ5xJ0mXW5xq1oQKZ5Lz5m';

export async function registerWithPassword(input: {
  email: string;
  password: string;
  name?: string;
  accountType?: 'retail' | 'wholesale';
  context?: LoginContext;
}): Promise<AuthResult> {
  const { email, password, name, accountType = 'retail', context = {} } = input;
  const normalisedEmail = email.toLowerCase();

  const existing = await User.findOne({ email: normalisedEmail });
  if (existing) {
    throw ApiError.conflict('An account with this email already exists.');
  }

  const user = await User.create({
    email: normalisedEmail,
    name,
    passwordHash: await passwordService.hashPassword(password),
    accountType,
    wholesaleStatus: accountType === 'wholesale' ? 'pending' : 'none',
    authProviders: ['password'],
    lastLoginAt: new Date(),
  });

  return buildAuthResult(user, context);
}

export async function loginWithPassword(input: {
  email: string;
  password: string;
  context?: LoginContext;
}): Promise<AuthResult> {
  const { email, password, context = {} } = input;

  // passwordHash is `select: false`, so it must be asked for explicitly.
  const user = await User.findOne({ email: email.toLowerCase() }).select('+passwordHash');

  // One message and one timing profile for every failure mode — wrong password,
  // no such account, or an account that only has Google/OTP credentials.
  const matches = await passwordService.verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !user.passwordHash || !matches) {
    throw ApiError.unauthorized('Incorrect email or password.', 'INVALID_CREDENTIALS');
  }

  if (!user.isActive) {
    throw ApiError.forbidden('This account has been deactivated. Please contact support.');
  }

  user.lastLoginAt = new Date();
  await user.save();

  return buildAuthResult(user, context);
}

/**
 * Google sign-in. Matches on the stable `sub` first, then falls back to email
 * so a customer who originally signed up with a password is *linked* rather
 * than duplicated.
 */
export async function loginWithGoogle(input: {
  idToken: string;
  context?: LoginContext;
}): Promise<AuthResult> {
  const { idToken, context = {} } = input;
  const identity = await googleService.verifyGoogleIdToken(idToken);

  let user = await User.findOne({ googleId: identity.googleId });

  if (!user) {
    user = await User.findOne({ email: identity.email });

    if (user) {
      // Existing password (or OTP) account — attach the Google credential to it.
      user.googleId = identity.googleId;
      if (!user.authProviders.includes('google')) user.authProviders.push('google');
      if (!user.name && identity.name) user.name = identity.name;
    }
  }

  if (!user) {
    // Note: no phone. That is why `phone` is sparse-unique on the model.
    user = await User.create({
      email: identity.email,
      name: identity.name,
      googleId: identity.googleId,
      accountType: 'retail',
      wholesaleStatus: 'none',
      authProviders: ['google'],
      lastLoginAt: new Date(),
    });
    return buildAuthResult(user, context);
  }

  if (!user.isActive) {
    throw ApiError.forbidden('This account has been deactivated. Please contact support.');
  }

  user.lastLoginAt = new Date();
  await user.save();

  return buildAuthResult(user, context);
}

/**
 * Step 1 of 3 — email a 6-digit code.
 *
 * Returns the same shape whether or not the address is registered (PRD 8.11);
 * the caller must not be able to tell.
 */
export async function requestPasswordReset(input: {
  email: string;
  ip?: string;
}): Promise<void> {
  const email = input.email.toLowerCase();
  const store = getStore();

  // Counted before the user lookup, so the quota applies identically to
  // addresses that do not exist. Keyed by email *and* IP: the email key stops
  // one address being mailbombed from many IPs, the IP key stops one host
  // walking a list of addresses.
  for (const key of [`pwreset:email:${email}`, `pwreset:ip:${input.ip ?? 'unknown'}`]) {
    const count = await store.incr(key);
    if (count === 1) await store.expire(key, 3600);
    if (count > env.FORGOT_PASSWORD_MAX_PER_HOUR) {
      throw ApiError.tooManyRequests(
        `You can request at most ${env.FORGOT_PASSWORD_MAX_PER_HOUR} reset codes per hour. Please try again later.`,
      );
    }
  }

  const user = await User.findOne({ email });
  // Silent no-op for unknown addresses: the controller still returns success.
  if (!user || !user.isActive) return;

  const otp = await passwordService.createResetOtp();
  user.passwordResetOtpHash = otp.codeHash;
  user.passwordResetOtpExpiresAt = otp.expiresAt;
  // A fresh code invalidates any token already minted from an older one.
  user.passwordResetTokenHash = undefined;
  user.passwordResetTokenExpiresAt = undefined;
  await user.save();

  // A new code clears the previous lockout counter for this address.
  await store.del(OTP_ATTEMPT_KEY(email));

  await emailService.sendPasswordResetEmail({
    to: email,
    code: otp.code,
    expiresInMinutes: env.PASSWORD_RESET_OTP_TTL_MINUTES,
  });
}

const OTP_ATTEMPT_KEY = (email: string) => `pwreset:attempts:${email}`;
const OTP_LOCK_KEY = (email: string) => `pwreset:lock:${email}`;

/**
 * Step 2 of 3 — verify the code, hand back a short-lived token.
 *
 * Mirrors the lockout the phone-OTP login used: wrong codes are counted per
 * email and the address is frozen once the ceiling is hit, which is what makes
 * a 6-digit secret defensible.
 */
export async function verifyPasswordResetOtp(input: {
  email: string;
  otp: string;
}): Promise<{ resetToken: string; expiresInSeconds: number }> {
  const email = input.email.toLowerCase();
  const store = getStore();

  if (await store.get(OTP_LOCK_KEY(email))) {
    const remaining = await store.ttl(OTP_LOCK_KEY(email));
    throw ApiError.tooManyRequests(
      `Too many incorrect codes. Try again in ${Math.max(1, Math.ceil(remaining / 60))} minute(s).`,
    );
  }

  const user = await User.findOne({ email }).select(
    '+passwordResetOtpHash +passwordResetOtpExpiresAt',
  );

  // One message for "no code pending", "wrong email" and "expired" alike, so
  // this step cannot be used to enumerate addresses either.
  const expired =
    !user?.passwordResetOtpHash ||
    !user.passwordResetOtpExpiresAt ||
    user.passwordResetOtpExpiresAt.getTime() <= Date.now();

  if (expired) {
    throw ApiError.unauthorized(
      'This code has expired. Please request a new one.',
      'RESET_OTP_EXPIRED',
    );
  }

  const matches = await passwordService.verifyResetOtp(
    input.otp,
    user.passwordResetOtpHash as string,
  );

  if (!matches) {
    const attempts = await store.incr(OTP_ATTEMPT_KEY(email));
    if (attempts === 1) {
      await store.expire(OTP_ATTEMPT_KEY(email), env.PASSWORD_RESET_OTP_TTL_MINUTES * 60);
    }

    if (attempts >= env.PASSWORD_RESET_MAX_ATTEMPTS) {
      await store.set(OTP_LOCK_KEY(email), '1', env.PASSWORD_RESET_LOCKOUT_MINUTES * 60);
      await store.del(OTP_ATTEMPT_KEY(email));
      // Burn the code as well, so the lockout cannot simply be waited out.
      user.passwordResetOtpHash = undefined;
      user.passwordResetOtpExpiresAt = undefined;
      await user.save();
      throw ApiError.tooManyRequests(
        `Too many incorrect codes. This email is locked for ${env.PASSWORD_RESET_LOCKOUT_MINUTES} minutes.`,
      );
    }

    const remaining = env.PASSWORD_RESET_MAX_ATTEMPTS - attempts;
    throw ApiError.unauthorized(
      `Incorrect code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`,
      'RESET_OTP_INVALID',
    );
  }

  // Single use: consume the code and swap it for the token.
  const reset = passwordService.createResetToken();
  user.passwordResetOtpHash = undefined;
  user.passwordResetOtpExpiresAt = undefined;
  user.passwordResetTokenHash = reset.tokenHash;
  user.passwordResetTokenExpiresAt = reset.expiresAt;
  await user.save();
  await store.del(OTP_ATTEMPT_KEY(email));

  return {
    resetToken: reset.token,
    expiresInSeconds: env.PASSWORD_RESET_TOKEN_TTL_MINUTES * 60,
  };
}

/**
 * Step 3 of 3 — set the new password.
 *
 * On success every other session is revoked, so a device the attacker still
 * holds is logged out rather than surviving the reset.
 */
export async function resetPassword(input: {
  token: string;
  password: string;
}): Promise<void> {
  const tokenHash = passwordService.hashResetToken(input.token);

  const user = await User.findOne({ passwordResetTokenHash: tokenHash }).select(
    '+passwordResetTokenHash +passwordResetTokenExpiresAt',
  );

  // A consumed token has had its hash cleared, so a replay lands here too.
  if (!user || !user.passwordResetTokenExpiresAt) {
    throw ApiError.badRequest('This reset request is invalid or has already been used.');
  }

  if (user.passwordResetTokenExpiresAt.getTime() <= Date.now()) {
    user.passwordResetTokenHash = undefined;
    user.passwordResetTokenExpiresAt = undefined;
    await user.save();
    throw ApiError.badRequest('This reset request has expired. Please start again.');
  }

  user.passwordHash = await passwordService.hashPassword(input.password);
  user.passwordResetTokenHash = undefined;
  user.passwordResetTokenExpiresAt = undefined;
  if (!user.authProviders.includes('password')) user.authProviders.push('password');
  await user.save();

  await tokenService.revokeAllSessions(user._id);
}

async function buildAuthResult(user: IUser, context: LoginContext): Promise<AuthResult> {
  const tokens = await tokenService.issueTokens(user, context);
  return {
    user: serializeUser(user),
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    accessTokenExpiresIn: tokens.accessTokenExpiresIn,
    refreshTokenExpiresAt: tokens.refreshTokenExpiresAt.toISOString(),
  };
}
