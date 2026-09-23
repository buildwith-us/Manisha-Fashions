import { api, clearTestDb, connectTestDb, disconnectTestDb, request } from './helpers/testServer';

// The real verifier would call Google. Mock the boundary, not our own logic.
const mockVerifyIdToken = jest.fn();
jest.mock('google-auth-library', () => ({
  OAuth2Client: class {
    verifyIdToken = mockVerifyIdToken;
  },
}));

function googleToken(payload: Record<string, unknown>) {
  mockVerifyIdToken.mockResolvedValueOnce({ getPayload: () => payload });
}

const VERIFIED = {
  sub: 'google-sub-12345',
  email: 'priya@example.com',
  email_verified: true,
  name: 'Priya R',
};


beforeAll(connectTestDb);
afterAll(disconnectTestDb);
afterEach(async () => {
  mockVerifyIdToken.mockReset();
  await clearTestDb();
});

describe('POST /auth/google', () => {
  it('creates a retail account for a first-time Google user', async () => {
    googleToken(VERIFIED);

    const res = await request.post(api('/auth/google')).send({ idToken: 'x'.repeat(30) });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user.email).toBe('priya@example.com');
    expect(res.body.data.user.accountType).toBe('retail');
    expect(res.body.data.user.authProviders).toEqual(['google']);
    // The whole point of the sparse index: a Google account has no phone.
    expect(res.body.data.user.phone).toBeUndefined();
    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.body.data.refreshToken).toBeTruthy();
  });

  it('links to the existing password account instead of duplicating it', async () => {
    await request.post(api('/auth/register')).send({
      email: 'priya@example.com',
      password: 'Sunflower77',
      name: 'Priya',
    });

    googleToken(VERIFIED);
    const res = await request.post(api('/auth/google')).send({ idToken: 'x'.repeat(30) });

    expect(res.status).toBe(200);
    expect(res.body.data.user.authProviders.sort()).toEqual(['google', 'password']);

    const { User } = await import('../models/user.model');
    expect(await User.countDocuments({ email: 'priya@example.com' })).toBe(1);
  });

  it('returns the same account on a second sign-in, matched on sub', async () => {
    googleToken(VERIFIED);
    const first = await request.post(api('/auth/google')).send({ idToken: 'x'.repeat(30) });

    // Email changed at Google; `sub` is stable, so it must still match.
    googleToken({ ...VERIFIED, email: 'priya.r@example.com' });
    const second = await request.post(api('/auth/google')).send({ idToken: 'x'.repeat(30) });

    expect(second.body.data.user.id).toBe(first.body.data.user.id);
  });

  it('refuses an unverified Google email', async () => {
    googleToken({ ...VERIFIED, email_verified: false });

    const res = await request.post(api('/auth/google')).send({ idToken: 'x'.repeat(30) });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('GOOGLE_EMAIL_UNVERIFIED');
  });

  it('refuses a token Google will not verify', async () => {
    mockVerifyIdToken.mockRejectedValueOnce(new Error('Invalid token signature'));

    const res = await request.post(api('/auth/google')).send({ idToken: 'x'.repeat(30) });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('GOOGLE_TOKEN_INVALID');
  });
});
