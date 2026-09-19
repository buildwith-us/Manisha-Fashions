import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/__tests__/**/*.test.ts'],
    // Each file boots its own in-memory Mongo; running them in parallel would
    // race on the shared rate-limit store, which is process-global.
    fileParallelism: false,
    hookTimeout: 120_000,
    testTimeout: 30_000,
    setupFiles: ['src/__tests__/setup.ts'],
  },
});
