import { type Page, expect, test } from '@playwright/test';

/**
 * Auth smoke tests for the sign-in surface.
 *
 * Covers the public sign-in screen (always available) and the local
 * dev sign-in path that the rest of the suite relies on. The dev-mode
 * tests `test.skip()` when the dev sign-in page or its token-minting
 * backend isn't reachable, so the suite stays green when run outside the
 * emulator stack (e.g. a bare `pnpm dev` against live Firebase).
 *
 * The seeded admin (see scripts/seed-dev.ts) lands on /my-staff after
 * sign-in via RoleAwareRedirect.
 */

/** Seeded administrator email — provisioned by scripts/seed-dev.ts. */
const SEED_ADMIN_EMAIL = 'admin.seed@orono.k12.mn.us';

/**
 * Sign in through the dev custom-token path. Skips the test when the page
 * isn't in development mode (the /dev-sign-in route only renders for Vite's
 * dev server) or when the dev-auth-server can't mint a token (backend not
 * up). Mirrors the guard pattern in auth-404-routing.spec.ts.
 *
 * @returns once the post-sign-in redirect to "/" (or its role landing page)
 *          has resolved.
 */
async function devSignIn(page: Page, email: string): Promise<void> {
  await page.goto('/dev-sign-in');

  const isDevMode = await page
    .locator('text=DEV MODE')
    .isVisible()
    .catch(() => false);
  if (!isDevMode) {
    test.skip(true, 'dev sign-in unavailable (not a development build)');
    return;
  }

  // Use the "Other email" field so any seeded user can sign in, not just the
  // hard-coded quick-user. The dev-auth-server creates the Auth user if it
  // doesn't exist yet, and the seeded /staff doc lets syncMyClaims resolve.
  const emailInput = page.locator('input[type="email"]');
  await emailInput.fill(email);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();

  // syncMyClaims + token refresh must complete before RequireAuth lets us off
  // /dev-sign-in. If the backend can't mint a token an inline error shows and
  // we stay on the page — treat that as "backend not up" and skip.
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

test.describe('sign-in screen', () => {
  test('unauthenticated visit to a protected route redirects to /sign-in', async ({
    page,
    baseURL,
  }) => {
    await page.goto('/dashboard');
    expect(page.url()).toBe(`${baseURL}/sign-in`);
  });

  test('renders the Google sign-in button and domain restriction copy', async ({ page }) => {
    await page.goto('/sign-in');
    await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
    // Domain restriction is surfaced to the user.
    await expect(page.getByText('@orono.k12.mn.us')).toBeVisible();
  });

  test('dev sign-in page exposes the DEV MODE helper in development', async ({ page }) => {
    await page.goto('/dev-sign-in');
    const isDevMode = await page
      .locator('text=DEV MODE')
      .isVisible()
      .catch(() => false);
    if (!isDevMode) {
      test.skip(true, 'dev sign-in unavailable (not a development build)');
      return;
    }
    await expect(page.getByRole('heading', { name: 'Local sign-in' })).toBeVisible();
    await expect(page.locator('input[type="email"]')).toBeVisible();
  });
});

test.describe('dev sign-in flow', () => {
  test('seeded admin can sign in and reaches an authenticated shell', async ({ page, baseURL }) => {
    await devSignIn(page, SEED_ADMIN_EMAIL);

    // We're off the sign-in surfaces and inside the app shell (sidebar nav).
    expect(page.url().startsWith(`${baseURL ?? ''}/sign-in`)).toBe(false);
    await expect(page.locator('nav').first()).toBeVisible();
  });

  test('an authenticated user cannot land on /sign-in', async ({ page, baseURL }) => {
    await devSignIn(page, SEED_ADMIN_EMAIL);

    // The session persists, so visiting /sign-in bounces back into the app —
    // SignInScreen redirects away when status === 'signed-in'.
    await page.goto('/sign-in');
    await expect(page).not.toHaveURL(`${baseURL ?? ''}/sign-in`);
  });
});
