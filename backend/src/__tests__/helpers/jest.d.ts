/// <reference types="jest" />

/**
 * TypeScript 6 no longer pulls every package under node_modules/@types into
 * the global scope automatically, so `describe`, `it` and `expect` were
 * unresolved in every spec. Referencing the package here brings them back for
 * the test tree alone.
 *
 * It lives under __tests__/ deliberately: tsconfig.build.json excludes that
 * directory, so a production install — which omits @types/jest along with the
 * rest of the devDependencies — still compiles.
 */
export {};
