import { type Page, expect, test } from '@playwright/test';

/**
 * Observation lifecycle smoke test: create -> edit -> autosave.
 *
 * Signs in as the seeded administrator (scripts/seed-dev.ts), who has
 * special access, opens the New Observation page, picks a seeded teacher,
 * creates a draft observation through the dialog, and verifies the editor
 * loads and autosaves an edit.
 *
 * Runs against the local emulator stack; the dev sign-in helper
 * `test.skip()`s when that backend isn't reachable so the suite stays green
 * outside the emulator environment.
 */

/** Seeded administrator — has special access, can create observations. */
const SEED_ADMIN_EMAIL = 'admin.seed@orono.k12.mn.us';
/** Seeded teacher to observe — provisioned by scripts/seed-dev.ts. */
const SEED_TEACHER_NAME = 'Teacher One';
const SEED_TEACHER_EMAIL = 'teacher.one@orono.k12.mn.us';

/**
 * Sign in via the dev custom-token path. Skips when the dev page or its
 * token-minting backend isn't available.
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

test.describe('new observation page', () => {
  test.beforeEach(async ({ page }) => {
    await devSignIn(page, SEED_ADMIN_EMAIL);
  });

  test('renders the staff picker', async ({ page }) => {
    await page.goto('/observations/new');
    await expect(page.getByRole('heading', { name: 'New observation' })).toBeVisible();
    // The seeded teacher appears in the picker table.
    await expect(page.getByText(SEED_TEACHER_NAME).first()).toBeVisible();
  });

  test('search filters the staff list down to a single match', async ({ page }) => {
    await page.goto('/observations/new');
    const search = page.getByPlaceholder('Search by name, email, role, or building');
    await search.fill(SEED_TEACHER_EMAIL);
    await expect(page.getByText(SEED_TEACHER_EMAIL).first()).toBeVisible();
  });
});

test.describe('observation create -> edit -> autosave', () => {
  test('creates a draft observation and autosaves an edit', async ({ page, baseURL }) => {
    await devSignIn(page, SEED_ADMIN_EMAIL);

    await page.goto('/observations/new');

    // Narrow to the seeded teacher and open the create dialog.
    await page
      .getByPlaceholder('Search by name, email, role, or building')
      .fill(SEED_TEACHER_EMAIL);
    await page.getByRole('button', { name: 'Observe', exact: true }).first().click();

    // The create dialog confirms the chosen staff member.
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'New observation' })).toBeVisible();

    // Default type (Standard) is fine; create the observation.
    await dialog.getByRole('button', { name: 'Create observation' }).click();

    // We land on the editor route for the new draft. Note: a plain
    // /\/observations\/[A-Za-z0-9]+$/ regex also matches the current
    // /observations/new URL, so it would resolve before the navigation —
    // explicitly exclude the "new" segment.
    await page.waitForURL(
      (url) =>
        /^\/observations\/[A-Za-z0-9]+$/.test(url.pathname) &&
        !url.pathname.endsWith('/observations/new'),
      { timeout: 15_000 },
    );
    expect(page.url()).not.toContain('/observations/new');

    // Editor renders: observed name heading + Draft status chip.
    await expect(page.getByRole('heading', { name: SEED_TEACHER_NAME })).toBeVisible();
    await expect(page.getByText('Draft', { exact: true })).toBeVisible();

    // Autosave: typing into the observation-name field flips the save
    // indicator's live region to "All changes saved" after the debounce.
    const nameInput = page.getByLabel('Observation name');
    await nameInput.fill('E2E smoke — Period 1');
    await expect(page.getByText('All changes saved')).toBeVisible({ timeout: 15_000 });

    // The edit survives a reload (it was persisted, not just local state).
    await page.reload();
    await expect(page.getByLabel('Observation name')).toHaveValue('E2E smoke — Period 1', {
      timeout: 15_000,
    });

    // Sanity: still on an observation editor route after the reload.
    expect(page.url().startsWith(`${baseURL ?? ''}/observations/`)).toBe(true);
  });
});
