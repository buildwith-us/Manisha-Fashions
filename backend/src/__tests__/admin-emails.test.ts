import { api, clearTestDb, connectTestDb, disconnectTestDb, request } from './helpers/testServer';

const mockVerifyIdToken = jest.fn();
jest.mock('google-auth-library', () => ({
  OAuth2Client: class {
    // A method, not a class field: jest hoists this factory above the `const`
    // below, and a field initialiser would read it while still in the TDZ.
    // A method body only evaluates when called, by which time it is defined.
    verifyIdToken(...args: unknown[]) {
      return mockVerifyIdToken(...args);
    }
  },
}));

function googleToken(payload: Record<string, unknown>) {
  mockVerifyIdToken.mockResolvedValueOnce({ getPayload: () => payload });
}


beforeAll(connectTestDb);
afterAll(disconnectTestDb);
afterEach(async () => {
  mockVerifyIdToken.mockReset();
  await clearTestDb();
});

const PASSWORD = 'Marigold42';

describe('ADMIN_EMAILS whitelist — email/password path', () => {
  it('makes a whitelisted address admin on first registration', async () => {
    const res = await request.post(api('/auth/register')).send({
      email: 'owner@example.com',
      password: PASSWORD,
    });

    expect(res.status).toBe(200);
    expect(res.body.data.user.accountType).toBe('admin');
  });

  it('matches case-insensitively and ignores padding in the env list', async () => {
    // The list holds " Owner@Example.com " — this must still match.
    const res = await request.post(api('/auth/register')).send({
      email: 'OWNER@example.com',
      password: PASSWORD,
    });
    expect(res.body.data.user.accountType).toBe('admin');
  });

  it('honours the second address in the list', async () => {
    const res = await request.post(api('/auth/register')).send({
      email: 'boss@example.com',
      password: PASSWORD,
    });
    expect(res.body.data.user.accountType).toBe('admin');
  });

  it('leaves a non-whitelisted address as retail', async () => {
    const res = await request.post(api('/auth/register')).send({
      email: 'shopper@example.com',
      password: PASSWORD,
    });
    expect(res.body.data.user.accountType).toBe('retail');
  });

  it('re-applies admin on every login, not just at signup', async () => {
    await request.post(api('/auth/register')).send({
      email: 'owner@example.com',
      password: PASSWORD,
    });

    // Simulate the role being changed in the database behind the app's back.
    const { User } = await import('../models/user.model');
    await User.updateOne({ email: 'owner@example.com' }, { $set: { accountType: 'retail' } });

    const res = await request.post(api('/auth/login')).send({
      email: 'owner@example.com',
      password: PASSWORD,
    });
    expect(res.body.data.user.accountType).toBe('admin');
  });

  it('demotes an admin whose address is not on the list', async () => {
    await request.post(api('/auth/register')).send({
      email: 'shopper@example.com',
      password: PASSWORD,
    });

    // Granted out of band — the list is the source of truth, so this is undone.
    const { User } = await import('../models/user.model');
    await User.updateOne({ email: 'shopper@example.com' }, { $set: { accountType: 'admin' } });

    const res = await request.post(api('/auth/login')).send({
      email: 'shopper@example.com',
      password: PASSWORD,
    });
    expect(res.body.data.user.accountType).toBe('retail');
  });

  it('demotes to wholesale, not retail, for an approved trade account', async () => {
    await request.post(api('/auth/register')).send({
      email: 'trade@example.com',
      password: PASSWORD,
      accountType: 'wholesale',
    });

    const { User } = await import('../models/user.model');
    await User.updateOne(
      { email: 'trade@example.com' },
      { $set: { accountType: 'admin', wholesaleStatus: 'approved' } },
    );

    const res = await request.post(api('/auth/login')).send({
      email: 'trade@example.com',
      password: PASSWORD,
    });
    expect(res.body.data.user.accountType).toBe('wholesale');
  });

  it('leaves staff alone — the list governs admin, not every elevated role', async () => {
    await request.post(api('/auth/register')).send({
      email: 'helper@example.com',
      password: PASSWORD,
    });

    const { User } = await import('../models/user.model');
    await User.updateOne({ email: 'helper@example.com' }, { $set: { accountType: 'staff' } });

    const res = await request.post(api('/auth/login')).send({
      email: 'helper@example.com',
      password: PASSWORD,
    });
    expect(res.body.data.user.accountType).toBe('staff');
  });
});

describe('ADMIN_EMAILS whitelist — Google path', () => {
  const identity = (email: string) => ({
    sub: `google-${email}`,
    email,
    email_verified: true,
    name: 'Google User',
  });

  it('makes a whitelisted address admin on first Google sign-in', async () => {
    googleToken(identity('owner@example.com'));

    const res = await request.post(api('/auth/google')).send({ idToken: 'x'.repeat(30) });

    expect(res.status).toBe(200);
    expect(res.body.data.user.accountType).toBe('admin');
  });

  it('leaves a non-whitelisted Google account as retail', async () => {
    googleToken(identity('shopper@example.com'));

    const res = await request.post(api('/auth/google')).send({ idToken: 'x'.repeat(30) });

    expect(res.body.data.user.accountType).toBe('retail');
  });

  it('re-applies admin on a returning Google sign-in', async () => {
    googleToken(identity('owner@example.com'));
    await request.post(api('/auth/google')).send({ idToken: 'x'.repeat(30) });

    const { User } = await import('../models/user.model');
    await User.updateOne({ email: 'owner@example.com' }, { $set: { accountType: 'retail' } });

    googleToken(identity('owner@example.com'));
    const res = await request.post(api('/auth/google')).send({ idToken: 'x'.repeat(30) });
    expect(res.body.data.user.accountType).toBe('admin');
  });

  it('demotes a non-whitelisted Google account that holds admin', async () => {
    googleToken(identity('shopper@example.com'));
    await request.post(api('/auth/google')).send({ idToken: 'x'.repeat(30) });

    const { User } = await import('../models/user.model');
    await User.updateOne({ email: 'shopper@example.com' }, { $set: { accountType: 'admin' } });

    googleToken(identity('shopper@example.com'));
    const res = await request.post(api('/auth/google')).send({ idToken: 'x'.repeat(30) });
    expect(res.body.data.user.accountType).toBe('retail');
  });
});
