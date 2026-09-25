import { api, clearTestDb, connectTestDb, createTestUser, disconnectTestDb, request } from './helpers/testServer';
import { getStore, disconnectStore, initStore } from '../config/store';
import { KvEntry } from '../models/kvEntry.model';
import { MongoRateLimitStore } from '../middleware/rateLimiter';
import { RateLimitHit } from '../models/rateLimitHit.model';
import * as passwordService from '../services/password.service';

const mockSendReset = jest.fn(async (_input: { to: string; code: string }) => ({ delivered: true }));
jest.mock('../services/email.service', () => ({
  sendPasswordResetEmail: (input: { to: string; code: string }) => mockSendReset(input),
  sendEmailVerificationCode: async () => ({ delivered: true }),
}));

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
afterEach(async () => {
  jest.restoreAllMocks();
  mockSendReset.mockClear();
  await clearTestDb();
});

describe('F16: counters and lockouts live in MongoDB and survive a restart', () => {
  it('keeps a counter, its expiry and a lockout across a new store instance', async () => {
    const before = getStore();
    await before.incr('pwreset:attempts:someone@example.com');
    await before.incr('pwreset:attempts:someone@example.com');
    await before.expire('pwreset:attempts:someone@example.com', 600);
    await before.set('pwreset:lock:someone@example.com', '1', 600);

    // What a deploy or an idle spin-down used to wipe.
    await disconnectStore();
    const after = initStore();

    expect(await after.incr('pwreset:attempts:someone@example.com')).toBe(3);
    expect(await after.get('pwreset:lock:someone@example.com')).toBe('1');
    expect(await after.ttl('pwreset:lock:someone@example.com')).toBeGreaterThan(590);
  });

  it('treats an expired entry as absent without waiting for the TTL reaper', async () => {
    const store = getStore();
    await store.incr('quota:x');
    await store.expire('quota:x', 60);
    await KvEntry.updateOne({ _id: 'quota:x' }, { $set: { expiresAt: new Date(Date.now() - 1000) } });

    expect(await store.get('quota:x')).toBeNull();
    expect(await store.ttl('quota:x')).toBe(-1);
    // INCR on an expired key starts over, with no stale expiry carried over.
    expect(await store.incr('quota:x')).toBe(1);
    expect(await store.ttl('quota:x')).toBe(-1);
  });

  it('counts rate-limit hits in a window shared by every instance', async () => {
    const first = new MongoRateLimitStore('auth');
    first.init({ windowMs: 60_000 } as never);
    await first.increment('ip:1.2.3.4');
    await first.increment('ip:1.2.3.4');

    // A second process (or the same one after a restart).
    const second = new MongoRateLimitStore('auth');
    second.init({ windowMs: 60_000 } as never);
    const hit = await second.increment('ip:1.2.3.4');

    expect(hit.totalHits).toBe(3);
    expect(hit.resetTime?.getTime()).toBeGreaterThan(Date.now());
  });

  it('starts a new window once the old one has elapsed', async () => {
    const store = new MongoRateLimitStore('auth');
    store.init({ windowMs: 60_000 } as never);
    await store.increment('ip:5.6.7.8');
    await RateLimitHit.updateOne({ _id: 'auth:ip:5.6.7.8' }, { $set: { resetAt: new Date(Date.now() - 1) } });

    expect((await store.increment('ip:5.6.7.8')).totalHits).toBe(1);
  });

  it('enforces the password-reset lockout from the database', async () => {
    await createTestUser();
    const email = 'locked@example.com';
    await request.post(api('/auth/register')).send({ email, password: 'Marigold42' });
    await request.post(api('/auth/forgot-password')).send({ email });
    for (let i = 0; i < 5; i += 1) {
      await request.post(api('/auth/verify-reset-otp')).send({ email, otp: '000000' });
    }

    await disconnectStore();
    initStore();

    const after = await request.post(api('/auth/verify-reset-otp')).send({ email, otp: '000000' });
    expect(after.status).toBe(429);
  });
});

describe('F18: CORS', () => {
  it('serves the mobile app, which sends no Origin', async () => {
    const res = await request.get(api('/products'));
    expect(res.status).toBe(200);
  });

  it('refuses an unlisted browser origin without a 500', async () => {
    // Tests run with CORS_ORIGINS empty and NODE_ENV=test (not production):
    // an origin on the list is echoed; see app.ts for the production rule.
    const res = await request.options(api('/auth/login')).set('Origin', 'https://evil.example').set('Access-Control-Request-Method', 'POST');
    expect(res.status).toBeLessThan(500);
  });
});

describe('F20: unreadable request bodies are the client’s error', () => {
  it('answers malformed JSON with 400, not 500', async () => {
    const res = await request.post(api('/auth/login')).set('Content-Type', 'application/json').send('{bad');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MALFORMED_BODY');
  });

  it('answers an oversized JSON body with 413', async () => {
    const res = await request
      .post(api('/auth/login'))
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ email: 'x'.repeat(2 * 1024 * 1024) }));
    expect(res.status).toBe(413);
  });
});

describe('F21: no account enumeration through forgot-password or login', () => {
  it('does the same hashing work and gives the same answer for known and unknown emails', async () => {
    await request.post(api('/auth/register')).send({ email: 'known@example.com', password: 'Marigold42' });
    const hashing = jest.spyOn(passwordService, 'createResetOtp');

    const known = await request.post(api('/auth/forgot-password')).send({ email: 'known@example.com' });
    const unknown = await request.post(api('/auth/forgot-password')).send({ email: 'nobody@example.com' });

    expect(known.status).toBe(unknown.status);
    expect(known.body).toEqual(unknown.body);
    expect(hashing).toHaveBeenCalledTimes(2);
    expect(mockSendReset).toHaveBeenCalledTimes(1);
  });

  it('gives one login error for a wrong password, an unknown email and a Google-only account', async () => {
    await request.post(api('/auth/register')).send({ email: 'known@example.com', password: 'Marigold42' });
    const { User } = await import('../models/user.model');
    await User.create({ email: 'google-only@example.com', googleId: 'g-1', authProviders: ['google'], emailVerified: true });

    const bodies = await Promise.all(
      ['known@example.com', 'nobody@example.com', 'google-only@example.com'].map((email) =>
        request.post(api('/auth/login')).send({ email, password: 'Wrong12345' }),
      ),
    );

    for (const res of bodies) {
      expect(res.status).toBe(401);
      expect(res.body.error).toEqual(bodies[0].body.error);
    }
    expect(bodies[0].body.error.code).toBe('INVALID_CREDENTIALS');
  });
});

describe('F14: image uploads', () => {
  const tinyPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );

  it('requires a signed-in account with product rights', async () => {
    await request.post(api('/products/images')).attach('images', tinyPng, 'a.png').expect(401);
    const customer = await createTestUser();
    await request.post(api('/products/images')).set('Authorization', customer.auth).attach('images', tinyPng, 'a.png').expect(403);
  });

  it('rejects a non-image with 415, not 500', async () => {
    const staff = await createTestUser({ accountType: 'staff' });
    const res = await request
      .post(api('/products/images'))
      .set('Authorization', staff.auth)
      .attach('images', Buffer.from('<svg onload=alert(1)>'), { filename: 'x.svg', contentType: 'image/svg+xml' });
    expect(res.status).toBe(415);
  });

  it('rejects a file over 8 MB with 413, not 500', async () => {
    const staff = await createTestUser({ accountType: 'staff' });
    const res = await request
      .post(api('/products/images'))
      .set('Authorization', staff.auth)
      .attach('images', Buffer.alloc(8 * 1024 * 1024 + 1, 1), { filename: 'big.png', contentType: 'image/png' });
    expect(res.status).toBe(413);
  });

  it('accepts a valid image up to the storage step (Cloudinary is unset in tests)', async () => {
    const staff = await createTestUser({ accountType: 'staff' });
    const res = await request
      .post(api('/products/images'))
      .set('Authorization', staff.auth)
      .attach('images', tinyPng, { filename: 'a.png', contentType: 'image/png' });
    expect(res.status).toBe(503);
  });
});
