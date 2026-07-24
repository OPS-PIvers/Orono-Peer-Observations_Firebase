import { defineConfig, devices } from '@playwright/test';

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
      // iPad Pro 11 landscape profile (viewport, touch, device-scale) run on
      // Chromium rather than the descriptor's default WebKit engine.
      //
      // Under WebKit the Firestore collection listeners never advance past
      // their first cached snapshot when pointed at the emulator suite: the
      // staff picker renders "0 of 1 match" (the one doc being the signed-in
      // user's own record, cached by the sidebar's document listener) and
      // stays there past a 30s wait, while the same specs pass on Chromium
      // against the same emulator data. Single-document listeners work, so
      // sign-in and the dashboard chrome are unaffected — it is the
      // collection watch stream that stalls.
      //
      // The project exists for tablet *layout* coverage, which Chromium at
      // this viewport gives us; whether the stall also reproduces on real
      // iPad Safari against production Firestore is tracked separately in
      // TODO.md and needs a device, not CI, to answer.
      name: 'tablet-ipad',
      use: { ...devices['iPad Pro 11 landscape'], browserName: 'chromium' },
    },
  ],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env['CI'],
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
