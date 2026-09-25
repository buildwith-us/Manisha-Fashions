import { spawnSync } from 'child_process';
import path from 'path';
import {
  PRODUCTION_TARGET_FLAG,
  assertScriptWriteTarget,
  assertTestDatabase,
  isLocalMongoUri,
  redactMongoUri,
} from '../config/dbTarget';

/**
 * Tests must never reach Atlas, and a script that writes data must not reach
 * production unless it is told to with --target=production.
 */

// Fake credentials and a fake cluster: even if a guard failed, nothing real
// could be reached.
const ATLAS = 'mongodb+srv://someone:s3cret@cluster0.guardtest.mongodb.net/manisha_fashions?retryWrites=true';
const REMOTE = 'mongodb://someone:s3cret@db.example.com:27017/manisha_fashions';

describe('isLocalMongoUri', () => {
  it.each([
    'mongodb://127.0.0.1:27017/manisha_fashions_test',
    'mongodb://localhost/manisha',
    'mongodb://[::1]:27017/x',
    'mongodb://user:pw@127.0.0.1:55123/',
    'mongodb://127.0.0.1:27017,localhost:27018/x?replicaSet=rs0',
  ])('treats %s as local', (uri) => {
    expect(isLocalMongoUri(uri)).toBe(true);
  });

  it.each([
    ATLAS,
    REMOTE,
    'mongodb://127.0.0.1:27017,db.example.com:27017/x',
    'mongodb+srv://localhost/x',
    '',
    'not a uri',
  ])('treats %s as not local', (uri) => {
    expect(isLocalMongoUri(uri)).toBe(false);
  });
});

describe('redactMongoUri', () => {
  it('never prints credentials or options, and names Atlas', () => {
    const shown = redactMongoUri(ATLAS);
    expect(shown).not.toContain('s3cret');
    expect(shown).not.toContain('someone');
    expect(shown).not.toContain('retryWrites');
    expect(shown).toContain('(MongoDB Atlas)');
  });
});

describe('assertTestDatabase', () => {
  it('allows the in-memory/local database', () => {
    expect(() => assertTestDatabase('mongodb://127.0.0.1:61234/')).not.toThrow();
  });

  it.each([ATLAS, REMOTE, undefined])('refuses %s', (uri) => {
    expect(() => assertTestDatabase(uri)).toThrow(/Refusing to run tests/);
  });

  it('does not leak the password in its message', () => {
    expect(() => assertTestDatabase(ATLAS)).toThrow(expect.objectContaining({
      message: expect.not.stringContaining('s3cret'),
    }));
  });

  it('is enforced by connectDatabase() whenever NODE_ENV is test', async () => {
    const previous = process.env.MONGODB_URI;
    process.env.MONGODB_URI = ATLAS;
    try {
      let connect: () => Promise<void> = async () => undefined;
      jest.isolateModules(() => {
        // A fresh config/env.ts reads the Atlas URI set above.
        connect = require('../config/database').connectDatabase;
      });
      await expect(connect()).rejects.toThrow(/Refusing to run tests/);
    } finally {
      process.env.MONGODB_URI = previous;
    }
  });
});

describe('assertScriptWriteTarget', () => {
  it('allows a local database without any flag', () => {
    expect(() => assertScriptWriteTarget('mongodb://127.0.0.1:27017/x', ['node', 'seed.ts'])).not.toThrow();
  });

  it.each([ATLAS, REMOTE])('refuses %s without the flag', (uri) => {
    expect(() => assertScriptWriteTarget(uri, ['node', 'seed.ts'])).toThrow(
      new RegExp(`Refusing to write.*${PRODUCTION_TARGET_FLAG}`),
    );
  });

  it('allows production only with the exact flag', () => {
    expect(() => assertScriptWriteTarget(ATLAS, ['node', 'seed.ts', PRODUCTION_TARGET_FLAG])).not.toThrow();
    expect(() => assertScriptWriteTarget(ATLAS, ['node', 'seed.ts', '--target=prod'])).toThrow();
    expect(() => assertScriptWriteTarget(ATLAS, ['node', 'seed.ts', '--target', 'production'])).toThrow();
  });
});

/*
  The real scripts, run as they would be from a terminal, pointed at a fake
  Atlas cluster. Each must refuse before connecting (a connect attempt would
  instead fail on DNS after a 10-second timeout, with a different message).
*/
describe('writing scripts refuse production without --target=production', () => {
  const backendRoot = path.resolve(__dirname, '../..');
  const tsx = path.join(backendRoot, 'node_modules/.bin/tsx');

  function run(script: string, args: string[] = []) {
    return spawnSync(tsx, [path.join('src/scripts', script), ...args], {
      cwd: backendRoot,
      encoding: 'utf8',
      timeout: 25_000,
      env: {
        ...process.env,
        NODE_ENV: 'development',
        MONGODB_URI: ATLAS,
        JWT_ACCESS_SECRET: 'guard-test-access-secret-0123456789',
        JWT_REFRESH_SECRET: 'guard-test-refresh-secret-0123456789',
        GOOGLE_WEB_CLIENT_ID: 'guard-test.apps.googleusercontent.com',
        // So the seed script gets past its own password check and it is the
        // production guard that refuses.
        SEED_ADMIN_PASSWORD: 'guard-test-password-123',
      },
    });
  }

  it.each([
    ['seed.ts', []],
    ['seedProducts.ts', []],
    ['makeAdmin.ts', ['someone@example.com']],
  ])('%s', (script, args) => {
    const result = run(script, args);
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status).toBe(1);
    expect(output).toMatch(/Refusing to write to .*MongoDB Atlas/);
    expect(output).toContain(PRODUCTION_TARGET_FLAG);
    expect(output).not.toContain('s3cret');
  });
});
