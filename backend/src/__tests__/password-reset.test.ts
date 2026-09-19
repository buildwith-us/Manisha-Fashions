import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Application } from 'express';
import { API, resetDb, startTestApp, stopTestApp } from './helpers';

interface ResetEmailInput {
  to: string;
  resetUrl: string;
  expiresInMinutes: number;
}

const sendPasswordResetEmail = vi.fn(async (_input: ResetEmailInput) => ({ delivered: true }));
vi.mock('../services/email.service', () => ({
  sendPasswordResetEmail: (input: ResetEmailInput) => sendPasswordResetEmail(input),
}));

let app: Application;

const ACCOUNT = { email: 'meera@example.com', password: 'Marigold42', name: 'Meera' };

async function registerAccount() {
  return request(app).post(`${API}/auth/register`).send(ACCOUNT);
}

/** Pulls the one-time token out of the deep link the email service was handed. */
function lastResetToken(): string {
  const call = sendPasswordResetEmail.mock.calls.at(-1)?.[0];
  if (!call) throw new Error('No reset email was sent');
  const token = new URL(
    call.resetUrl.replace('manishafashions://', 'https://x/'),
  ).searchParams.get('token');
  if (!token) throw new Error('Reset link carried no token');
  return token;
}

beforeAll(async () => {
  app = await startTestApp();
});
afterAll(stopTestApp);
afterEach(async () => {
  sendPasswordResetEmail.mockClear();
  await resetDb();
});

describe('POST /auth/forgot-password', () => {
  it('gives an identical response for registered and unregistered emails', async () => {
    await registerAccount();

    const known = await request(app).post(`${API}/auth/forgot-password`).send({
      email: ACCOUNT.email,
    });
    const unknown = await request(app).post(`${API}/auth/forgot-password`).send({
      email: 'nobody@example.com',
    });

    expect(known.status).toBe(unknown.status);
    expect(known.body).toEqual(unknown.body);
    // ...and only the real account actually triggers an email.
    expect(sendPasswordResetEmail).toHaveBeenCalledTimes(1);
  });

  it('allows 3 requests per hour then refuses the 4th', async () => {
    await registerAccount();

    for (let i = 0; i < 3; i += 1) {
      const ok = await request(app).post(`${API}/auth/forgot-password`).send({
        email: ACCOUNT.email,
      });
      expect(ok.status).toBe(200);
    }

    const blocked = await request(app).post(`${API}/auth/forgot-password`).send({
      email: ACCOUNT.email,
    });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
  });

  it('counts unregistered addresses against the quota too', async () => {
    // Otherwise the rate limit itself reveals which addresses exist.
    for (let i = 0; i < 3; i += 1) {
      await request(app).post(`${API}/auth/forgot-password`).send({ email: 'ghost@example.com' });
    }
    const blocked = await request(app).post(`${API}/auth/forgot-password`).send({
      email: 'ghost@example.com',
    });
    expect(blocked.status).toBe(429);
  });
});

describe('POST /auth/reset-password', () => {
  it('accepts a valid token, then signs the user in with the new password', async () => {
    await registerAccount();
    await request(app).post(`${API}/auth/forgot-password`).send({ email: ACCOUNT.email });

    const res = await request(app).post(`${API}/auth/reset-password`).send({
      token: lastResetToken(),
      password: 'Jasmine9000',
    });
    expect(res.status).toBe(200);

    const relogin = await request(app).post(`${API}/auth/login`).send({
      email: ACCOUNT.email,
      password: 'Jasmine9000',
    });
    expect(relogin.status).toBe(200);

    const stale = await request(app).post(`${API}/auth/login`).send(ACCOUNT);
    expect(stale.status).toBe(401);
  });

  it('refuses a token that has already been used', async () => {
    await registerAccount();
    await request(app).post(`${API}/auth/forgot-password`).send({ email: ACCOUNT.email });
    const token = lastResetToken();

    await request(app).post(`${API}/auth/reset-password`).send({ token, password: 'Jasmine9000' });
    const replay = await request(app).post(`${API}/auth/reset-password`).send({
      token,
      password: 'Different111',
    });

    expect(replay.status).toBe(400);
  });

  it('refuses an expired token', async () => {
    await registerAccount();
    await request(app).post(`${API}/auth/forgot-password`).send({ email: ACCOUNT.email });
    const token = lastResetToken();

    // Wind the stored expiry into the past rather than waiting 15 minutes.
    const { User } = await import('../models/user.model');
    await User.updateOne(
      { email: ACCOUNT.email },
      { $set: { passwordResetExpiresAt: new Date(Date.now() - 1000) } },
    );

    const res = await request(app).post(`${API}/auth/reset-password`).send({
      token,
      password: 'Jasmine9000',
    });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/expired/i);
  });

  it('refuses a token that was never issued', async () => {
    const res = await request(app).post(`${API}/auth/reset-password`).send({
      token: 'z'.repeat(43),
      password: 'Jasmine9000',
    });
    expect(res.status).toBe(400);
  });

  it('revokes existing sessions so other devices must sign in again', async () => {
    const registered = await registerAccount();
    const oldRefresh = registered.body.data.refreshToken;

    await request(app).post(`${API}/auth/forgot-password`).send({ email: ACCOUNT.email });
    await request(app).post(`${API}/auth/reset-password`).send({
      token: lastResetToken(),
      password: 'Jasmine9000',
    });

    const refreshed = await request(app).post(`${API}/auth/refresh`).send({
      refreshToken: oldRefresh,
    });
    expect(refreshed.status).toBe(401);
  });
});
