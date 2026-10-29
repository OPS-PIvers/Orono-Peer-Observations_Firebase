import { type Page, expect, test } from '@playwright/test';

/**
 * Draft privacy, end to end: the observed teacher sees their Draft through
 * the teacher view, not the observation document.
 *
 * A Peer Evaluator creates and names a Draft; the onObservationTeacherView
 * trigger (Functions emulator) writes the teacher's copy; the teacher then
 * finds it under My Observations and opens it. The rules deny the teacher a
 * read of the Draft observation itself, so this passes only if every page on
 * that path reads /teacherViews.
 */

const SEED_PE_EMAIL = 'pe.alpha@orono.k12.mn.us';
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
    // In CI (against the emulator stack) an unreachable backend is a real
    // failure, not an expected local condition — skipping here would let a
    // broken/slow dev-auth-server produce a false-green run. Only skip when
    // running locally without the emulator stack up.
    if (process.env.CI) {
      throw new Error('dev-auth-server / emulator backend not reachable');
    }
    test.skip(true, 'dev-auth-server / emulator backend not reachable');
  }
}

test('the observed teacher opens their Draft from My Observations', async ({ browser }) => {
  const name = `Draft privacy ${String(Date.now())}`;

  const peContext = await browser.newContext();
  const pe = await peContext.newPage();
  await devSignIn(pe, SEED_PE_EMAIL);
  await pe.goto('/observations/new');
  await pe.getByPlaceholder('Search by name, email, role, or building').fill(SEED_TEACHER_EMAIL);
  await pe.getByRole('button', { name: 'Observe', exact: true }).first().click();
  await pe.getByRole('dialog').getByRole('button', { name: 'Create observation' }).click();
  await pe.waitForURL(
    (url) =>
      /^\/observations\/[A-Za-z0-9]+$/.test(url.pathname) &&
      !url.pathname.endsWith('/observations/new'),
    { timeout: 15_000 },
  );
  await pe.getByLabel('Observation name').fill(name);
  await expect(pe.getByText('Saved', { exact: true })).toBeVisible({ timeout: 15_000 });
  await peContext.close();

  const teacherContext = await browser.newContext();
  const teacher = await teacherContext.newPage();
  await devSignIn(teacher, SEED_TEACHER_EMAIL);
  await teacher.goto('/my-observations');
  const inProgress = teacher.getByRole('region', { name: 'Observations in progress' });
  // The view is written by a trigger, so it can trail the save a little.
  const draftLink = inProgress.getByRole('link', { name });
  await expect(draftLink).toBeVisible({ timeout: 30_000 });

  await draftLink.click();
  await expect(teacher.getByRole('heading', { name: SEED_TEACHER_NAME })).toBeVisible({
    timeout: 15_000,
  });
  await expect(teacher.getByText('Draft', { exact: true })).toBeVisible();
  await expect(teacher.getByText('insufficient permissions', { exact: false })).toHaveCount(0);
  await teacherContext.close();
});
