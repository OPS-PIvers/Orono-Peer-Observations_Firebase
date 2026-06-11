import { type Page, expect, test } from '@playwright/test';

/**
 * Staff dashboard smoke tests.
 *
 * Signs in as a seeded teacher (scripts/seed-dev.ts) — plain staff land on
 * /dashboard via RoleAwareRedirect — and asserts the dashboard chrome
 * renders: the welcome hero, the checkpoint filter tabs, and the
 * peer-evaluator sidebar card.
 *
 * These run against the local emulator stack; the dev sign-in helper
 * `test.skip()`s when that backend isn't reachable so the suite never
 * produces false failures outside the emulator environment.
 */

/** Seeded plain-staff teacher — provisioned by scripts/seed-dev.ts. */
const SEED_TEACHER_EMAIL = 'teacher.one@orono.k12.mn.us';

/**
 * Sign in via the dev custom-token path and wait for the role-aware redirect
 * to settle. Skips when the dev page or backend isn't available.
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

test.describe('staff dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await devSignIn(page, SEED_TEACHER_EMAIL);
    // RoleAwareRedirect sends plain staff to /dashboard; navigate explicitly
    // so the assertions don't depend on which landing page resolved first.
    await page.goto('/dashboard');
  });

  test('renders the welcome hero for the seeded teacher', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /Welcome back/i })).toBeVisible();
  });

  test('shows the checkpoint filter tabs', async ({ page }) => {
    const filterBar = page.getByRole('tablist', { name: 'Filter checkpoints' });
    await expect(filterBar).toBeVisible();
    // The four canonical filters are all rendered as tabs.
    await expect(filterBar.getByRole('tab', { name: /All/ })).toBeVisible();
    await expect(filterBar.getByRole('tab', { name: /Active now/ })).toBeVisible();
    await expect(filterBar.getByRole('tab', { name: /Upcoming/ })).toBeVisible();
    await expect(filterBar.getByRole('tab', { name: /Completed/ })).toBeVisible();
  });

  test('switching to the Completed filter updates the selected tab', async ({ page }) => {
    const filterBar = page.getByRole('tablist', { name: 'Filter checkpoints' });
    const completedTab = filterBar.getByRole('tab', { name: /Completed/ });
    await completedTab.click();
    await expect(completedTab).toHaveAttribute('aria-selected', 'true');
  });

  test('renders the peer-evaluator sidebar card', async ({ page }) => {
    // The seed has no active observation for this teacher yet, so the card
    // shows its empty-state copy — either way the card heading is present.
    await expect(page.getByText('Your peer evaluator')).toBeVisible();
  });
});
