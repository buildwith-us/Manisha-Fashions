/// <reference types="jest" />

/**
 * TypeScript 6 no longer pulls every package under node_modules/@types into
 * the global scope automatically, so `describe`, `it` and `expect` were
 * unresolved in every spec under src/**\/__tests__. Referencing the package
 * here brings them back without narrowing `types`, which would also have cut
 * off the ambient declarations Expo and React Native rely on.
 */
export {};
