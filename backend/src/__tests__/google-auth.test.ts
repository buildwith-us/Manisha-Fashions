import { api, clearTestDb, connectTestDb, disconnectTestDb, request } from './helpers/testServer';
import { User } from '../models/user.model';

const mockSendPasswordResetEmail = jest.fn(async (_input: { code: string }) => ({ delivered: true }));
jest.mock('../services/email.service', () => ({
  sendPasswordResetEmail: (input: { code: string }) => mockSendPasswordResetEmail(input),
}));

const mockVerifyIdToken = jest.fn();
jest.mock('google-auth-library', () => ({
  OAuth2Client: class {
    // A method, not a class field: jest hoists this factory above the `const`
    // above, and a field initialiser would read it while still in the TDZ.
    verifyIdToken(...args: unknown[]) {
      return mockVerifyIdToken(...args);
    }
  },
}));

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
afterEach(async () => {
  mockVerifyIdToken.mockReset();
  mockSendPasswordResetEmail.mockClear();
  await clearTestDb();
});

const ID_TOKEN = 'header.payload.signature-from-google';
const PASSWORD = 'Marigold42';

function googleIdentity(overrides: Record<string, unknown> = {}) {
  const payload = {
    sub: 'google-sub-123',
    email: 'Shopper@Example.com',
    email_verified: true,
    name: 'Google Shopper',
    picture: 'https://lh3.googleusercontent.com/a/photo',
    ...overrides,
  };
  mockVerifyIdToken.mockResolvedValueOnce({ getPayload: () => payload });
  return payload;
}

const signInWithGoogle = () => request.post(api('/auth/google')).send({ idToken: ID_TOKEN });

describe('POST /auth/google', () => {
  it('creates a new retail user and returns the standard auth shape', async () => {
    googleIdentity();

    const res = await signInWithGoogle();

    expect(res.status).toBe(200);
    expect(mockVerifyIdToken).toHaveBeenCalledWith({
      idToken: ID_TOKEN,
      audience: 'test-web-client.apps.googleusercontent.com',
    });

    const { data } = res.body;
    expect(Object.keys(data).sort()).toEqual(
      ['accessToken', 'accessTokenExpiresIn', 'refreshToken', 'refreshTokenExpiresAt', 'user'].sort(),
    );
    expect(data.user).toMatchObject({
      email: 'shopper@example.com',
      name: 'Google Shopper',
      avatar: 'https://lh3.googleusercontent.com/a/photo',
      accountType: 'retail',
      wholesaleStatus: 'none',
      authProviders: ['google'],
    });
    // Nothing internal leaks through the serializer.
    expect(data.user).not.toHaveProperty('passwordHash');
    expect(data.user).not.toHaveProperty('googleId');

    const saved = await User.findOne({ email: 'shopper@example.com' }).select('+passwordHash');
    expect(saved?.googleId).toBe('google-sub-123');
    expect(saved?.passwordHash).toBeUndefined();
  });

  it('logs a returning Google user in by googleId without creating another account', async () => {
    googleIdentity();
    await signInWithGoogle();

    // Same `sub`, different email: the stable id wins.
    googleIdentity({ email: 'renamed@example.com' });
    const res = await signInWithGoogle();

    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe('shopper@example.com');
    expect(await User.countDocuments()).toBe(1);
  });

  it('links an existing VERIFIED email/password account and keeps its password', async () => {
    const registered = await request
      .post(api('/auth/register'))
      .send({ email: 'shopper@example.com', password: PASSWORD, name: 'Original Name' });
    expect(registered.status).toBe(200);
    await User.updateOne({ email: 'shopper@example.com' }, { $set: { emailVerified: true } });

    googleIdentity();
    const res = await signInWithGoogle();

    expect(res.status).toBe(200);
    expect(res.body.data.user.id).toBe(registered.body.data.user.id);
    expect(res.body.data.user.name).toBe('Original Name');
    expect(res.body.data.user.authProviders.sort()).toEqual(['google', 'password']);
    expect(await User.countDocuments()).toBe(1);

    // The owner proved the address before, so their password stays.
    const login = await request
      .post(api('/auth/login'))
      .send({ email: 'shopper@example.com', password: PASSWORD });
    expect(login.status).toBe(200);
  });

  /*
    F10 — account pre-hijacking. Registration never proves the address, so an
    attacker can register the victim's email with a password first. When the
    real owner signs in with Google, that password must stop working and every
    session the attacker holds must end.
  */
  it('removes the password and revokes sessions when linking an UNVERIFIED account', async () => {
    const attacker = await request
      .post(api('/auth/register'))
      .send({ email: 'shopper@example.com', password: PASSWORD });
    expect(attacker.body.data.user.emailVerified).toBe(false);

    googleIdentity();
    const res = await signInWithGoogle();

    expect(res.status).toBe(200);
    expect(res.body.data.user.id).toBe(attacker.body.data.user.id);
    expect(res.body.data.user.authProviders).toEqual(['google']);
    expect(res.body.data.user.emailVerified).toBe(true);

    const passwordLogin = await request
      .post(api('/auth/login'))
      .send({ email: 'shopper@example.com', password: PASSWORD });
    expect(passwordLogin.status).toBe(401);
    await request
      .post(api('/auth/refresh'))
      .send({ refreshToken: attacker.body.data.refreshToken })
      .expect(401);
    // The owner's fresh Google session is unaffected.
    await request.post(api('/auth/refresh')).send({ refreshToken: res.body.data.refreshToken }).expect(200);
  });

  it('never changes wholesale status when linking', async () => {
    await request
      .post(api('/auth/register'))
      .send({ email: 'shopper@example.com', password: PASSWORD, accountType: 'wholesale' });

    googleIdentity();
    const res = await signInWithGoogle();

    expect(res.body.data.user.accountType).toBe('wholesale');
    expect(res.body.data.user.wholesaleStatus).toBe('pending');
  });

  it('gives a whitelisted ADMIN_EMAILS address the admin role', async () => {
    googleIdentity({ email: 'owner@example.com', sub: 'google-owner' });

    const res = await signInWithGoogle();

    expect(res.status).toBe(200);
    expect(res.body.data.user.accountType).toBe('admin');
  });

  it('rejects a token whose email is not verified with 401', async () => {
    googleIdentity({ email_verified: false });

    const res = await signInWithGoogle();

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('GOOGLE_EMAIL_UNVERIFIED');
    expect(await User.countDocuments()).toBe(0);
  });

  it('rejects an invalid or expired token with 401', async () => {
    mockVerifyIdToken.mockRejectedValueOnce(new Error('Token used too late'));

    const res = await signInWithGoogle();

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('GOOGLE_TOKEN_INVALID');
  });

  it('rejects a missing idToken with 400 without calling Google', async () => {
    const res = await request.post(api('/auth/google')).send({});

    expect(res.status).toBe(400);
    expect(mockVerifyIdToken).not.toHaveBeenCalled();
  });
});

describe('password login on a Google-only account', () => {
  it('explains that the account uses Google Sign-In', async () => {
    googleIdentity();
    await signInWithGoogle();

    const res = await request
      .post(api('/auth/login'))
      .send({ email: 'shopper@example.com', password: PASSWORD });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('GOOGLE_ACCOUNT_NO_PASSWORD');
    expect(res.body.error.message).toBe(
      'This account uses Google Sign-In. Continue with Google, or reset your password to set one.',
    );
  });

  it('lets the reset flow set a password, after which both methods work', async () => {
    googleIdentity();
    await signInWithGoogle();

    await request.post(api('/auth/forgot-password')).send({ email: 'shopper@example.com' });
    const code = mockSendPasswordResetEmail.mock.calls.at(-1)?.[0].code;
    const verified = await request
      .post(api('/auth/verify-reset-otp'))
      .send({ email: 'shopper@example.com', otp: code });
    const reset = await request
      .post(api('/auth/reset-password'))
      .send({ token: verified.body.data.resetToken, password: PASSWORD });
    expect(reset.status).toBe(200);

    const login = await request
      .post(api('/auth/login'))
      .send({ email: 'shopper@example.com', password: PASSWORD });
    expect(login.status).toBe(200);
    expect(login.body.data.user.authProviders.sort()).toEqual(['google', 'password']);

    googleIdentity();
    expect((await signInWithGoogle()).status).toBe(200);
  });

  it('still reports a plain wrong password as invalid credentials', async () => {
    await request
      .post(api('/auth/register'))
      .send({ email: 'shopper@example.com', password: PASSWORD });

    const res = await request
      .post(api('/auth/login'))
      .send({ email: 'shopper@example.com', password: 'WrongPass1' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });
});
