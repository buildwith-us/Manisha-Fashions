import { User, type IUser } from '../models/user.model';
import { ApiError } from '../utils/ApiError';
import { serializeUser, type SerializedUser } from '../serializers/user.serializer';
import * as otpService from './otp.service';
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
