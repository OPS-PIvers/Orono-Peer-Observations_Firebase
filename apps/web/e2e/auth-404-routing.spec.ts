import { type Page, expect, test } from '@playwright/test';

/**
 * Tests for catch-all 404 route behavior.
 *
 * On main the catch-all `<Route path="*">` is registered at the top level,
 * outside the authenticated Layout shell (see apps/web/src/App.tsx), so the
 * NotFound page renders bare — for signed-in and signed-out users alike —
 * without redirecting and without the sidebar chrome. These tests assert
 * that actual behavior.
 */

/** Seeded administrator — provisioned by scripts/seed-dev.ts. */
const SEED_ADMIN_EMAIL = 'admin.seed@orono.k12.mn.us';

/**
 * Sign in via the dev custom-token path and wait for the role-aware redirect
 * to settle off the sign-in surfaces. Skips when the dev page or its
 * token-minting backend isn't reachable (mirrors the other e2e specs).
 */
async function devSignIn(page: Page, email: string): Promise<void> {
  await page.goto('/dev-sign-in');

  // DevSignIn is a lazy-loaded route chunk — wait for it to render instead
  // of sampling visibility immediately, which skips flakily on cold loads
  // (e.g. CI, where the Vite dev server compiles modules on first request).
  const isDevMode = await page
    .getByText('DEV MODE')
    .waitFor({ state: 'visible', timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  if (!isDevMode) {
    test.skip(true, 'dev sign-in unavailable (not a development build)');
    return;
  }

  await page.locator('input[type="email"]').fill(email);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();

  const landed = await page
    .waitForURL((url) => !url.pathname.startsWith('/dev-sign-in') && url.pathname !== '/sign-in', {
      timeout: 15_000,
    })
    .then(() => true)
    .catch(() => false);

  if (!landed) {
    test.skip(true, 'dev-auth-server / emulator backend not reachable');
  }
}

test.describe('404 routing for unknown paths', () => {
  test('unauthenticated user visiting /nonexistent sees the NotFound page', async ({
    page,
    baseURL,
  }) => {
    await page.goto('/nonexistent');

    // The catch-all route is public, so an unknown path renders NotFound
    // rather than bouncing to /sign-in.
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Back to home' })).toBeVisible();
    expect(page.url()).toBe(`${baseURL ?? ''}/nonexistent`);
  });

  test('authenticated user visiting /nonexistent sees the NotFound page', async ({
    page,
    baseURL,
  }) => {
    await devSignIn(page, SEED_ADMIN_EMAIL);

    await page.goto('/nonexistent');

    // Stays on /nonexistent and shows NotFound (not redirected to /sign-in).
    expect(page.url()).toBe(`${baseURL ?? ''}/nonexistent`);
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();

    // "Back to home" navigates to "/" (which the role-aware redirect may then
    // forward to a role landing page) — assert only that we leave /nonexistent.
    await page.getByRole('link', { name: 'Back to home' }).click();
    await page.waitForURL((url) => url.pathname !== '/nonexistent');
  });

  test('authenticated user visiting an unknown admin path sees the NotFound page', async ({
    page,
  }) => {
    await devSignIn(page, SEED_ADMIN_EMAIL);

    // No nested catch-all under /admin, so this falls through to the
    // top-level NotFound rather than an unauthorized screen.
    await page.goto('/admin/nonexistent');
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  });
});
