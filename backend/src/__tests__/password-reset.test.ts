import { api, clearTestDb, connectTestDb, disconnectTestDb, request } from './helpers/testServer';

interface ResetEmailInput {
  to: string;
  code: string;
  expiresInMinutes: number;
}

const mockSendPasswordResetEmail = jest.fn(async (_input: ResetEmailInput) => ({ delivered: true }));
jest.mock('../services/email.service', () => ({
  sendPasswordResetEmail: (input: ResetEmailInput) => mockSendPasswordResetEmail(input),
}));


const ACCOUNT = { email: 'meera@example.com', password: 'Marigold42', name: 'Meera' };

async function registerAccount() {
  return request.post(api('/auth/register')).send(ACCOUNT);
}

/** The 6-digit code handed to the email service on the most recent send. */
function lastCode(): string {
  const call = mockSendPasswordResetEmail.mock.calls.at(-1)?.[0];
  if (!call) throw new Error('No reset email was sent');
  return call.code;
}

/** Walks steps 1–2 and returns the short-lived token from the verify step. */
async function getResetToken(): Promise<string> {
  await request.post(api('/auth/forgot-password')).send({ email: ACCOUNT.email });
  const res = await request.post(api('/auth/verify-reset-otp'))
    .send({ email: ACCOUNT.email, otp: lastCode() });
  return res.body.data.resetToken;
}

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
afterEach(async () => {
  mockSendPasswordResetEmail.mockClear();
  await clearTestDb();
});

describe('POST /auth/forgot-password', () => {
  it('emails a 6-digit code, not a link', async () => {
    await registerAccount();
    await request.post(api('/auth/forgot-password')).send({ email: ACCOUNT.email });

    const call = mockSendPasswordResetEmail.mock.calls.at(-1)?.[0];
    expect(call?.code).toMatch(/^\d{6}$/);
    expect(call).not.toHaveProperty('resetUrl');
  });

  it('gives an identical response for registered and unregistered emails', async () => {
    await registerAccount();

    const known = await request.post(api('/auth/forgot-password')).send({
      email: ACCOUNT.email,
    });
    const unknown = await request.post(api('/auth/forgot-password')).send({
      email: 'nobody@example.com',
    });

    expect(known.status).toBe(unknown.status);
    expect(known.body).toEqual(unknown.body);
    // ...and only the real account actually triggers an email.
    expect(mockSendPasswordResetEmail).toHaveBeenCalledTimes(1);
  });

  it('allows 3 requests per hour then refuses the 4th', async () => {
    await registerAccount();

    for (let i = 0; i < 3; i += 1) {
      const ok = await request.post(api('/auth/forgot-password')).send({
        email: ACCOUNT.email,
      });
      expect(ok.status).toBe(200);
    }

    const blocked = await request.post(api('/auth/forgot-password')).send({
      email: ACCOUNT.email,
    });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
  });

  it('counts unregistered addresses against the quota too', async () => {
    // Otherwise the rate limit itself reveals which addresses exist.
    for (let i = 0; i < 3; i += 1) {
      await request.post(api('/auth/forgot-password')).send({ email: 'ghost@example.com' });
    }
    const blocked = await request.post(api('/auth/forgot-password')).send({
      email: 'ghost@example.com',
    });
    expect(blocked.status).toBe(429);
  });
});

describe('POST /auth/verify-reset-otp', () => {
  it('accepts the emailed code and returns a reset token', async () => {
    await registerAccount();
    await request.post(api('/auth/forgot-password')).send({ email: ACCOUNT.email });

    const res = await request.post(api('/auth/verify-reset-otp'))
      .send({ email: ACCOUNT.email, otp: lastCode() });

    expect(res.status).toBe(200);
    expect(res.body.data.resetToken).toBeTruthy();
  });

  it('rejects an expired code', async () => {
    await registerAccount();
    await request.post(api('/auth/forgot-password')).send({ email: ACCOUNT.email });
    const code = lastCode();

    // Wind the stored expiry into the past rather than waiting 10 minutes.
    const { User } = await import('../models/user.model');
    await User.updateOne(
      { email: ACCOUNT.email },
      { $set: { passwordResetOtpExpiresAt: new Date(Date.now() - 1000) } },
    );

    const res = await request.post(api('/auth/verify-reset-otp'))
      .send({ email: ACCOUNT.email, otp: code });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('RESET_OTP_EXPIRED');
  });

  it('counts wrong codes down and locks the email after 5', async () => {
    await registerAccount();
    await request.post(api('/auth/forgot-password')).send({ email: ACCOUNT.email });

    const wrong = (otp: string) =>
      request.post(api('/auth/verify-reset-otp')).send({ email: ACCOUNT.email, otp });

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const res = await wrong('000000');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('RESET_OTP_INVALID');
      expect(res.body.error.message).toContain(`${5 - attempt} attempt`);
    }

    const locked = await wrong('000000');
    expect(locked.status).toBe(429);
    expect(locked.body.error.message).toMatch(/locked/i);
  });

  it('refuses the correct code once the email is locked out', async () => {
    await registerAccount();
    await request.post(api('/auth/forgot-password')).send({ email: ACCOUNT.email });
    const code = lastCode();

    for (let i = 0; i < 5; i += 1) {
      await request.post(api('/auth/verify-reset-otp'))
        .send({ email: ACCOUNT.email, otp: '000000' });
    }

    const res = await request.post(api('/auth/verify-reset-otp'))
      .send({ email: ACCOUNT.email, otp: code });
    expect(res.status).toBe(429);
  });

  it('does not reveal whether an unregistered email has a code pending', async () => {
    const res = await request.post(api('/auth/verify-reset-otp'))
      .send({ email: 'ghost@example.com', otp: '123456' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('RESET_OTP_EXPIRED');
  });

  it('consumes the code, so it cannot be verified twice', async () => {
    await registerAccount();
    await request.post(api('/auth/forgot-password')).send({ email: ACCOUNT.email });
    const code = lastCode();

    await request.post(api('/auth/verify-reset-otp')).send({ email: ACCOUNT.email, otp: code });
    const replay = await request.post(api('/auth/verify-reset-otp'))
      .send({ email: ACCOUNT.email, otp: code });

    expect(replay.status).toBe(401);
  });
});

describe('POST /auth/reset-password', () => {
  it('accepts the token from the verify step and swaps the password', async () => {
    await registerAccount();
    const token = await getResetToken();

    const res = await request.post(api('/auth/reset-password')).send({
      token,
      password: 'Jasmine9000',
    });
    expect(res.status).toBe(200);

    const relogin = await request.post(api('/auth/login')).send({
      email: ACCOUNT.email,
      password: 'Jasmine9000',
    });
    expect(relogin.status).toBe(200);

    const stale = await request.post(api('/auth/login')).send(ACCOUNT);
    expect(stale.status).toBe(401);
  });

  it('refuses a reset token that has already been used', async () => {
    await registerAccount();
    const token = await getResetToken();

    await request.post(api('/auth/reset-password')).send({ token, password: 'Jasmine9000' });
    const replay = await request.post(api('/auth/reset-password')).send({
      token,
      password: 'Different111',
    });

    expect(replay.status).toBe(400);
  });

  it('refuses an expired reset token', async () => {
    await registerAccount();
    const token = await getResetToken();

    const { User } = await import('../models/user.model');
    await User.updateOne(
      { email: ACCOUNT.email },
      { $set: { passwordResetTokenExpiresAt: new Date(Date.now() - 1000) } },
    );

    const res = await request.post(api('/auth/reset-password')).send({
      token,
      password: 'Jasmine9000',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/expired/i);
  });

  it('refuses a token that was never issued', async () => {
    const res = await request.post(api('/auth/reset-password')).send({
      token: 'z'.repeat(43),
      password: 'Jasmine9000',
    });
    expect(res.status).toBe(400);
  });

  it('revokes existing sessions so other devices must sign in again', async () => {
    const registered = await registerAccount();
    const oldRefresh = registered.body.data.refreshToken;

    const token = await getResetToken();
    await request.post(api('/auth/reset-password')).send({
      token,
      password: 'Jasmine9000',
    });

    const refreshed = await request.post(api('/auth/refresh')).send({
      refreshToken: oldRefresh,
    });
    expect(refreshed.status).toBe(401);
  });
});
