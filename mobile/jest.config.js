/**
 * jest-expo wires up the RN/Expo-specific Babel transform and the module
 * mocks Expo's native modules need (expo-secure-store, expo-constants, ...).
 * Individual tests still mock what they touch directly where the default
 * mock isn't enough (see api/__tests__/client.test.ts).
 */
const expoPreset = require('jest-expo/jest-preset');

/**
 * Redux ships ESM builds (`immer.legacy-esm.js`, `react-redux.legacy-esm.js`).
 * jest-expo's default ignore list covers the Expo/RN packages but not those,
 * so Jest tried to run them through the CommonJS loader and threw
 * "Unexpected token 'export'". Rather than hand-write the whole pattern and
 * let it drift from the preset, take the preset's own first entry and add
 * these to the negative lookahead.
 */
const [expoPackages, ...restOfPreset] = expoPreset.transformIgnorePatterns;

module.exports = {
  preset: 'jest-expo',
  testMatch: ['<rootDir>/src/**/__tests__/**/*.test.{ts,tsx}'],
  moduleNameMapper: {
    // Native module; see the mock for why.
    '^react-native-webview$': '<rootDir>/src/__mocks__/react-native-webview.tsx',
  },
  transformIgnorePatterns: [
    expoPackages.replace('|standard-navigation))', '|standard-navigation|immer|@reduxjs/toolkit|react-redux))'),
    ...restOfPreset,
  ],
};
