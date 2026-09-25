import { spawnSync } from 'child_process';
import path from 'path';
import jwt from 'jsonwebtoken';
import { api, clearTestDb, connectTestDb, disconnectTestDb, request } from './helpers/testServer';
import { weakSecretReason } from '../config/env';
import { RefreshToken } from '../models/refreshToken.model';
import { User } from '../models/user.model';

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
afterEach(clearTestDb);

const PASSWORD = 'Marigold42';

async function signUp(email = 'person@example.com') {
  const res = await request.post(api('/auth/register')).send({ email, password: PASSWORD });
  expect(res.status).toBe(200);
  return res.body.data as { accessToken: string; refreshToken: string; user: { id: string } };
}

const refresh = (refreshToken: string) => request.post(api('/auth/refresh')).send({ refreshToken });

describe('F19: refresh-token reuse detection', () => {
  it('revokes the whole family when an already-rotated token is replayed', async () => {
    const session = await signUp();
    const rotated = await refresh(session.refreshToken).expect(200);

    // The original token again: a stolen copy, or the owner after the thief.
    const replay = await refresh(session.refreshToken);
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('REFRESH_TOKEN_REUSED');

    // The legitimate successor is dead too — both parties must sign in again.
    await refresh(rotated.body.data.refreshToken).expect(401);
  });

  it('leaves other sign-ins (other families) alone', async () => {
    const phone = await signUp();
    const tablet = (await request.post(api('/auth/login')).send({ email: 'person@example.com', password: PASSWORD })).body.data;

    await refresh(phone.refreshToken).expect(200);
    await refresh(phone.refreshToken).expect(401);

    await refresh(tablet.refreshToken).expect(200);
  });

  it('treats two simultaneous rotations of one token as reuse', async () => {
    const session = await signUp();

    const [a, b] = await Promise.all([refresh(session.refreshToken), refresh(session.refreshToken)]);

    expect([a.status, b.status].sort()).toEqual([200, 401]);
    const winner = a.status === 200 ? a : b;
    await refresh(winner.body.data.refreshToken).expect(401);
  });

  it('still rotates normally, carrying the family forward', async () => {
    const session = await signUp();
    const first = await refresh(session.refreshToken).expect(200);
    const second = await refresh(first.body.data.refreshToken).expect(200);
    await refresh(second.body.data.refreshToken).expect(200);

    const families = await RefreshToken.distinct('familyId', { userId: session.user.id });
    expect(families).toHaveLength(1);
  });

  it('handles a token issued before families existed', async () => {
    const session = await signUp();
    await RefreshToken.updateMany({ userId: session.user.id }, { $unset: { familyId: 1 } });

    const rotated = await refresh(session.refreshToken).expect(200);
    await refresh(session.refreshToken).expect(401);
    await refresh(rotated.body.data.refreshToken).expect(401);
  });
});

describe('F9: refresh re-checks the admin whitelist and the account', () => {
  it('demotes an admin that is not on ADMIN_EMAILS at the next refresh', async () => {
    const session = await signUp('shopper@example.com');
    await User.updateOne({ _id: session.user.id }, { $set: { accountType: 'admin', emailVerified: true } });

    const res = await refresh(session.refreshToken).expect(200);

    expect(res.body.data.user.accountType).toBe('retail');
    expect((await User.findById(session.user.id))?.accountType).toBe('retail');
  });

  it('refuses a deactivated account and revokes all of its sessions', async () => {
    const session = await signUp();
    const other = (await request.post(api('/auth/login')).send({ email: 'person@example.com', password: PASSWORD })).body.data;
    await User.updateOne({ _id: session.user.id }, { $set: { isActive: false } });

    const res = await refresh(session.refreshToken);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('ACCOUNT_INACTIVE');

    await User.updateOne({ _id: session.user.id }, { $set: { isActive: true } });
    await refresh(other.refreshToken).expect(401);
  });
});

describe('F22: tokens are HS256 only', () => {
  it('rejects an access token signed with another algorithm, even with the right secret', async () => {
    const session = await signUp();
    const decoded = jwt.decode(session.accessToken) as Record<string, unknown>;
    const { iat: _iat, exp: _exp, ...claims } = decoded;
    const hs512 = jwt.sign(claims, process.env.JWT_ACCESS_SECRET as string, { algorithm: 'HS512', expiresIn: '5m' });

    await request.get(api('/auth/me')).set('Authorization', `Bearer ${hs512}`).expect(401);
    await request.get(api('/auth/me')).set('Authorization', `Bearer ${session.accessToken}`).expect(200);
  });
});

describe('F13: production refuses weak JWT secrets', () => {
  const strong = 'uN7q2vX9rT4kLm8pZs3wYc6bHd1fGj5eRa0oQiVxWnE';

  it.each([
    ['too short', 'short-but-random-9f8e7d6c5b4a'],
    ['the .env.example placeholder', 'change-me-to-a-64-char-random-string'],
    ['a test fixture', 'test-access-secret-at-least-16-chars'],
    ['placeholder wording', 'my-super-secret-password-goes-here-please'],
    ['repetitive', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
  ])('flags %s', (_label, value) => {
    expect(weakSecretReason(value)).not.toBeNull();
  });

  it('accepts a long random value', () => {
    expect(weakSecretReason(strong)).toBeNull();
  });

  function bootProduction(overrides: Record<string, string>) {
    const saved = { ...process.env };
    Object.assign(process.env, {
      NODE_ENV: 'production',
      GOOGLE_WEB_CLIENT_ID: 'prod-test.apps.googleusercontent.com',
      SMTP_USER: 'store@example.com',
      SMTP_APP_PASSWORD: 'abcd efgh ijkl mnop',
      JWT_ACCESS_SECRET: strong,
      JWT_REFRESH_SECRET: `${strong}-refresh-Zq8`,
      ...overrides,
    });
    try {
      jest.isolateModules(() => {
        require('../config/env');
      });
    } finally {
      process.env = saved;
    }
  }

  it('boots with strong, distinct secrets', () => {
    expect(() => bootProduction({})).not.toThrow();
  });

  it('refuses the published placeholder, and identical secrets', () => {
    expect(() => bootProduction({ JWT_ACCESS_SECRET: 'change-me-to-a-64-char-random-string' })).toThrow(
      /JWT_ACCESS_SECRET is a published placeholder/,
    );
    expect(() => bootProduction({ JWT_REFRESH_SECRET: strong })).toThrow(/must be different/);
  });
});

describe('F22: the seed script has no default admin password', () => {
  it('refuses to run without SEED_ADMIN_PASSWORD, before connecting', () => {
    const backendRoot = path.resolve(__dirname, '../..');
    const result = spawnSync(path.join(backendRoot, 'node_modules/.bin/tsx'), ['src/scripts/seed.ts'], {
      cwd: backendRoot,
      encoding: 'utf8',
      timeout: 25_000,
      env: {
        ...process.env,
        NODE_ENV: 'development',
        MONGODB_URI: 'mongodb://127.0.0.1:1/never-reached',
        SEED_ADMIN_PASSWORD: '',
      },
    });

    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toMatch(/Set SEED_ADMIN_PASSWORD/);
  });
});
