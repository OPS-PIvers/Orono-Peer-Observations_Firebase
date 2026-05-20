import { defineConfig } from 'vitest/config';

/**
 * Dedicated Vitest config for Firestore rules tests. Runs against the
 * Firestore emulator (port 8080) — invoke via:
 *
 *     pnpm test:rules
 *
 * which wraps this config in `firebase emulators:exec --only firestore`.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/rules/**/*.test.ts'],
    testTimeout: 20_000,
    hookTimeout: 20_000,
    // All rules files share one emulator project, and each clears Firestore
    // in beforeEach — so files must run serially or their clears race.
    fileParallelism: false,
  },
});
