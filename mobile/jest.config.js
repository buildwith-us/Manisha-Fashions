/**
 * jest-expo wires up the RN/Expo-specific Babel transform and the module
 * mocks Expo's native modules need (expo-secure-store, expo-constants, ...).
 * Individual tests still mock what they touch directly where the default
 * mock isn't enough (see api/__tests__/client.test.ts).
 */
module.exports = {
  preset: 'jest-expo',
  testMatch: ['<rootDir>/src/**/__tests__/**/*.test.{ts,tsx}'],
  // Deliberately not overriding transformIgnorePatterns — jest-expo's preset
  // already ships one tuned to the current Expo SDK's package set, and a
  // hand-written one here would only go stale against it.
};
