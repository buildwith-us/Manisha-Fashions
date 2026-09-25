import { User, type IUser } from '../models/user.model';
import { ApiError } from '../utils/ApiError';
import { serializeUser, type SerializedUser } from '../serializers/user.serializer';
import { env } from '../config/env';
import { getStore } from '../config/store';
import * as emailService from './email.service';
import * as googleService from './google.service';
import * as passwordService from './password.service';
import * as tokenService from './token.service';

/**
 * Admin is granted by the ADMIN_EMAILS env list, re-evaluated on every sign-in
 * rather than written once at signup, so editing the list takes effect on the
 * next login instead of needing a database edit.
 *
 * Only to a VERIFIED address. Holding a whitelisted address in the email field
 * is not proof of owning it — an account used to be able to type one in via
 * PATCH /auth/me and become admin on the next login. Verification comes from a
 * Google sign-in, a completed password reset, or the emailed-code flow.
 *
 * It demotes as well as promotes: an account removed from the list loses admin
 * the next time it signs in. `staff` is left alone — this list governs the
 * admin role specifically, not every elevated role.
 */
function isAdminEmail(email?: string): boolean {
  if (!email) return false;
  const normalised = email.trim().toLowerCase();
  return env.ADMIN_EMAILS.some((entry) => entry.trim().toLowerCase() === normalised);
}

/**
 * Returns true when the caller must persist the document afterwards.
 * Silent no-op for staff, and for anyone whose role already matches the list.
 */
function syncAdminRole(user: IUser): boolean {
  const shouldBeAdmin = user.emailVerified === true && isAdminEmail(user.email);

  if (shouldBeAdmin && user.accountType !== 'admin') {
    user.accountType = 'admin';
    user.wholesaleStatus = 'none';
    return true;
  }

  if (!shouldBeAdmin && user.accountType === 'admin') {
    // Fall back to the ordinary tier: an approved wholesale buyer who was
    // temporarily an admin keeps their wholesale pricing, everyone else is retail.
    user.accountType = user.wholesaleStatus === 'approved' ? 'wholesale' : 'retail';
    return true;
  }

  return false;
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

/**
 * Name only. The email is a login credential and the key ADMIN_EMAILS matches
 * on, so it changes solely through requestEmailCode → confirmEmailCode.
 */
export async function updateProfile(
  userId: string,
  updates: { name?: string },
): Promise<SerializedUser> {
  const $set = updates.name !== undefined ? { name: updates.name } : {};
  const user = await User.findByIdAndUpdate(userId, { $set }, { new: true });
  if (!user) throw ApiError.notFound('Account not found');
  return serializeUser(user);
}

/* ── Verify or change the account email ─────────────────────────────────── */

const EMAIL_CODE_QUOTA_KEY = (userId: string) => `emailcode:quota:${userId}`;
const EMAIL_CODE_ATTEMPT_KEY = (userId: string) => `emailcode:attempts:${userId}`;
const EMAIL_CODE_LOCK_KEY = (userId: string) => `emailcode:lock:${userId}`;

/**
 * Step 1 — email a 6-digit code to `email`.
 *
 * The same flow serves two purposes: sending it to the account's CURRENT
 * address verifies that address; sending it to a NEW one changes the email
 * once the code comes back. Nothing about the account changes until then.
 */
export async function requestEmailCode(
  userId: string,
  email: string,
): Promise<{ email: string; purpose: 'verify' | 'change'; expiresInMinutes: number }> {
  const target = email.trim().toLowerCase();
  const user = await User.findById(userId);
  if (!user) throw ApiError.notFound('Account not found');

  const purpose = target === user.email ? 'verify' : 'change';
  if (purpose === 'verify' && user.emailVerified) {
    throw ApiError.conflict('Your email address is already verified.');
  }
  if (purpose === 'change') {
    // Case-insensitive by construction: every stored email is lowercased.
    const taken = await User.exists({ email: target, _id: { $ne: user._id } });
    if (taken) throw ApiError.conflict('That email address is already in use.');
  }

  const store = getStore();
  const sent = await store.incr(EMAIL_CODE_QUOTA_KEY(userId));
  if (sent === 1) await store.expire(EMAIL_CODE_QUOTA_KEY(userId), 3600);
  if (sent > env.FORGOT_PASSWORD_MAX_PER_HOUR) {
    throw ApiError.tooManyRequests(
      `You can request at most ${env.FORGOT_PASSWORD_MAX_PER_HOUR} codes per hour. Please try again later.`,
    );
  }

  const otp = await passwordService.createResetOtp();
  await User.updateOne(
    { _id: user._id },
    { $set: { pendingEmail: target, emailCodeHash: otp.codeHash, emailCodeExpiresAt: otp.expiresAt } },
  );
  // A fresh code starts a fresh set of attempts.
  await store.del(EMAIL_CODE_ATTEMPT_KEY(userId));

  await emailService.sendEmailVerificationCode({
    to: target,
    code: otp.code,
    expiresInMinutes: env.PASSWORD_RESET_OTP_TTL_MINUTES,
    purpose,
  });

  return { email: target, purpose, expiresInMinutes: env.PASSWORD_RESET_OTP_TTL_MINUTES };
}

/**
 * Step 2 — check the code and apply it.
 *
 * On a change, the address is re-checked for a clash (it may have been taken
 * since step 1), and every other session is revoked: whoever held the old
 * address should not stay signed in on the strength of it. This device gets a
 * fresh token pair in the response, so it stays signed in.
 */
export async function confirmEmailCode(input: {
  userId: string;
  otp: string;
  context?: LoginContext;
}): Promise<AuthResult & { changed: boolean }> {
  const { userId, otp, context = {} } = input;
  const store = getStore();

  if (await store.get(EMAIL_CODE_LOCK_KEY(userId))) {
    const remaining = await store.ttl(EMAIL_CODE_LOCK_KEY(userId));
    throw ApiError.tooManyRequests(
      `Too many incorrect codes. Try again in ${Math.max(1, Math.ceil(remaining / 60))} minute(s).`,
    );
  }

  const user = await User.findById(userId).select('+pendingEmail +emailCodeHash +emailCodeExpiresAt');
  if (!user) throw ApiError.notFound('Account not found');

  if (
    !user.pendingEmail ||
    !user.emailCodeHash ||
    !user.emailCodeExpiresAt ||
    user.emailCodeExpiresAt.getTime() <= Date.now()
  ) {
    // 400, not 401: the caller IS signed in; only the code is wrong. A 401 here
    // would read as a dead session and sign the app out.
    throw new ApiError(400, 'This code has expired. Please request a new one.', 'EMAIL_CODE_EXPIRED');
  }

  if (!(await passwordService.verifyResetOtp(otp, user.emailCodeHash))) {
    const attempts = await store.incr(EMAIL_CODE_ATTEMPT_KEY(userId));
    if (attempts === 1) {
      await store.expire(EMAIL_CODE_ATTEMPT_KEY(userId), env.PASSWORD_RESET_OTP_TTL_MINUTES * 60);
    }
    if (attempts >= env.PASSWORD_RESET_MAX_ATTEMPTS) {
      await store.set(EMAIL_CODE_LOCK_KEY(userId), '1', env.PASSWORD_RESET_LOCKOUT_MINUTES * 60);
      await store.del(EMAIL_CODE_ATTEMPT_KEY(userId));
      // Burn the code too, so waiting out the lock does not reopen it.
      await User.updateOne(
        { _id: user._id },
        { $unset: { pendingEmail: 1, emailCodeHash: 1, emailCodeExpiresAt: 1 } },
      );
      throw ApiError.tooManyRequests(
        `Too many incorrect codes. Please request a new code in ${env.PASSWORD_RESET_LOCKOUT_MINUTES} minutes.`,
      );
    }
    const remaining = env.PASSWORD_RESET_MAX_ATTEMPTS - attempts;
    throw new ApiError(
      400,
      `Incorrect code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`,
      'EMAIL_CODE_INVALID',
    );
  }

  const target = user.pendingEmail;
  const changed = target !== user.email;
  if (changed && (await User.exists({ email: target, _id: { $ne: user._id } }))) {
    throw ApiError.conflict('That email address is already in use.');
  }

  user.email = target;
  user.emailVerified = true;
  user.pendingEmail = undefined;
  user.emailCodeHash = undefined;
  user.emailCodeExpiresAt = undefined;
  // A proven address is exactly what the ADMIN_EMAILS rule waits for.
  syncAdminRole(user);
  await user.save();
  await store.del(EMAIL_CODE_ATTEMPT_KEY(userId));

  if (changed) await tokenService.revokeAllSessions(user._id);
  return { ...(await buildAuthResult(user, context)), changed };
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

  // A whitelisted address is admin from its very first session.
  if (syncAdminRole(user)) await user.save();

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

  // One timing profile for every failure mode: the bcrypt compare runs even
  // when there is no account or no hash to compare against.
  const matches = await passwordService.verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);

  // A Google-created account has no password until one is set through the
  // reset flow. Saying so is friendlier than "incorrect password", at the cost
  // of revealing that this address has a Google account here.
  if (user && !user.passwordHash && user.googleId) {
    throw ApiError.unauthorized(
      'This account uses Google Sign-In. Continue with Google, or reset your password to set one.',
      'GOOGLE_ACCOUNT_NO_PASSWORD',
    );
  }

  // One message for everything else — wrong password, no such account, or an
  // OTP-only account.
  if (!user || !user.passwordHash || !matches) {
    throw ApiError.unauthorized('Incorrect email or password.', 'INVALID_CREDENTIALS');
  }

  if (!user.isActive) {
    throw ApiError.forbidden('This account has been deactivated. Please contact support.');
  }

  syncAdminRole(user);
  user.lastLoginAt = new Date();
  await user.save();

  return buildAuthResult(user, context);
}

/**
 * Google sign-in from a verified native ID token.
 *
 * Matches on the stable `sub` first, then on email, so a customer who signed
 * up with a password is linked rather than duplicated. Account type and
 * wholesale status are never touched here beyond the ADMIN_EMAILS sync that
 * every sign-in applies — a new Google account starts as plain retail.
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
      // The address already belongs to an account linked to a *different*
      // Google identity. Refuse rather than silently re-point the account.
      if (user.googleId && user.googleId !== identity.googleId) {
        throw ApiError.conflict(
          'This email is linked to a different Google account. Sign in with your password instead.',
        );
      }
      // Existing password (or OTP) account — attach the Google credential.
      // Google has verified this exact address (email_verified is required).
      user.emailVerified = true;
      user.googleId = identity.googleId;
      if (!user.authProviders.includes('google')) user.authProviders.push('google');
      if (!user.name && identity.name) user.name = identity.name;
      if (!user.avatar && identity.picture) user.avatar = identity.picture;
    }
  }

  if (!user) {
    // No password and no phone — both fields are optional for this reason.
    user = await User.create({
      email: identity.email,
      name: identity.name,
      avatar: identity.picture,
      googleId: identity.googleId,
      emailVerified: true,
      accountType: 'retail',
      wholesaleStatus: 'none',
      authProviders: ['google'],
      lastLoginAt: new Date(),
    });
    if (syncAdminRole(user)) await user.save();
    return buildAuthResult(user, context);
  }

  if (!user.isActive) {
    throw ApiError.forbidden('This account has been deactivated. Please contact support.');
  }

  // A returning Google user whose address is still the one Google verified.
  if (user.email === identity.email) user.emailVerified = true;
  syncAdminRole(user);
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
  // The code reached this inbox, so the account demonstrably owns the address.
  user.emailVerified = true;
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
