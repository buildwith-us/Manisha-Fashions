/**
 * Jest hits the real Express app in-process (createApp() from src/app.ts) over
 * Supertest, against a per-file mongodb-memory-server instance — no live
 * server, no shared database between test files.
 *
 * mongodb-memory-server downloads a MongoDB binary on first run and caches it
 * under ~/.cache/mongodb-binaries — that first download needs network access
 * and can take a minute or two; subsequent runs are fast.
 */
module.exports = {
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/src/__tests__/**/*.test.ts'],
  transform: { '^.+\\.ts$': 'babel-jest' },
  // config/env.ts parses process.env the moment it is imported and throws on a
  // missing secret, so the fixture values have to be in place before any module
  // loads — setupFiles runs early enough, setupFilesAfterEnv does not.
  setupFiles: ['<rootDir>/src/__tests__/helpers/env.ts'],
  // helpers/ holds the harness, not specs.
  testPathIgnorePatterns: ['<rootDir>/node_modules/', '<rootDir>/src/__tests__/helpers/'],
  // Each mongodb-memory-server boot (per test file) is slow relative to a
  // typical unit test; give every test in the file room for that plus a real
  // HTTP round trip through Supertest.
  testTimeout: 30_000,
  clearMocks: true,
  // Every test file spins up its own mongod; running many in parallel spawns
  // that many binaries at once, which is heavier than most CI boxes handle
  // gracefully. `npm test` already passes --runInBand for that reason — this
  // is a second guard for anyone invoking `jest` directly.
  maxWorkers: 1,
};
