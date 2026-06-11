import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for the @ops/web smoke suite.
 *
 * The specs in ./e2e exercise the core evaluator/admin loop (dev sign-in,
 * staff dashboard, new-observation create flow, booking page) against the
 * **local emulator stack**, not live Firebase.
 *
 * How the backend is wired
 * ------------------------
 * `pnpm test:e2e` is expected to run *inside* the Firebase emulator suite so
 * the Vite dev server (and the dev-auth-server below) talk to Auth +
 * Firestore + Functions emulators seeded by `pnpm seed:dev`. The canonical
 * entry point — used by CI — is:
 *
 *   firebase emulators:exec --import=./fixtures/seed \
 *     "pnpm seed:dev && pnpm test:e2e"
 *
 * (CI wiring for the GitHub Actions workflow is owned separately.)
 *
 * Two web servers are started for the run:
 *   1. The Vite dev server, forced to emulator mode (VITE_USE_EMULATORS=true)
 *      so every SDK call hits the local stack.
 *   2. The dev-auth-server, pointed at the Auth emulator (FIREBASE_AUTH_*
 *      _EMULATOR_HOST) so it mints custom tokens against the emulator without
 *      needing Application Default Credentials. The /dev-sign-in page fetches
 *      tokens from it.
 *
 * Specs degrade gracefully: each sign-in helper `test.skip()`s when the dev
 * sign-in path or seeded backend isn't reachable, so the suite never produces
 * false failures when run outside the emulator stack (e.g. a bare `pnpm dev`
 * against live Firebase on a developer machine).
 */

const DEV_AUTH_PORT = 8787;
/** Must match firebase.json emulators.auth.port and the FIRESTORE port. */
const AUTH_EMULATOR_HOST = '127.0.0.1:9099';
const FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
const PROJECT_ID = 'peer-evaluator-rubric';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  workers: process.env['CI'] ? 1 : 4,
  reporter: process.env['CI'] ? [['github'], ['html']] : 'html',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'desktop-chrome',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'tablet-ipad',
      use: { ...devices['iPad Pro 11 landscape'] },
    },
  ],
  webServer: [
    {
      // Vite dev server, forced to emulator mode so the whole suite runs
      // against the local Firebase stack rather than live project data.
      command: 'pnpm dev',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env['CI'],
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        VITE_USE_EMULATORS: 'true',
        VITE_FIREBASE_PROJECT_ID: PROJECT_ID,
      },
    },
    {
      // Dev auth helper that mints custom tokens for /dev-sign-in. Pointed at
      // the Auth emulator so it works without Application Default Credentials.
      command: 'node ../../scripts/dev-auth-server.mjs',
      url: `http://127.0.0.1:${String(DEV_AUTH_PORT)}/health`,
      reuseExistingServer: !process.env['CI'],
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        DEV_AUTH_PORT: String(DEV_AUTH_PORT),
        FIREBASE_PROJECT_ID: PROJECT_ID,
        GCLOUD_PROJECT: PROJECT_ID,
        FIREBASE_AUTH_EMULATOR_HOST: AUTH_EMULATOR_HOST,
        FIRESTORE_EMULATOR_HOST,
      },
    },
  ],
});
