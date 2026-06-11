import { expect, test } from '@playwright/test';

/**
 * Tests for catch-all 404 route behavior.
 * Ensures that unknown paths are properly protected and display in the correct context:
 * - Unauthenticated users are redirected to /sign-in
 * - Authenticated users see the 404 inside the normal Layout (with sidebar/header)
 */

test.describe('404 routing for unknown paths', () => {
  test('unauthenticated user visiting /nonexistent redirects to /sign-in', async ({
    page,
    baseURL,
  }) => {
    // Navigate to a nonexistent path
    await page.goto('/nonexistent');

    // Should be redirected to sign-in. The redirect is a client-side
    // navigation that lands after Firebase resolves the (signed-out) auth
    // state — poll with toHaveURL rather than asserting page.url().
    await expect(page).toHaveURL(`${baseURL ?? ''}/sign-in`);

    // Sign-in screen should be visible (not the NotFound page)
    await expect(page.locator('button:has-text("Continue with Google")')).toBeVisible();
  });

  test('authenticated user visiting /nonexistent shows 404 with sidebar', async ({
    page,
    baseURL,
  }) => {
    // Set up authenticated session by using dev sign-in
    // First navigate to the dev sign-in page
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
      // Skip this test if not in development mode (dev-sign-in won't be available)
      test.skip();
      return;
    }

    // Click on Paul Ivers quick user button to sign in
    const paulButton = page.locator('button:has-text("Paul Ivers")');
    await paulButton.click();

    // Wait for redirect to home after sign-in
    await page.waitForURL(`${baseURL}/`);

    // Now navigate to a nonexistent path while authenticated
    await page.goto('/nonexistent');

    // Should stay at /nonexistent (not redirect to /sign-in)
    expect(page.url()).toBe(`${baseURL}/nonexistent`);

    // NotFound component should be visible with "Page not found" text
    await expect(page.locator('text=Page not found')).toBeVisible();

    // Layout/sidebar should be present (indicates we're inside the auth shell)
    // The sidebar navigation should be visible
    const sidebar = page.locator('nav');
    await expect(sidebar).toBeVisible();

    // Back to home button should be present (from NotFound component)
    const backButton = page.locator('a:has-text("Back to home")');
    await expect(backButton).toBeVisible();

    // Clicking back to home should navigate to / (which the role-aware
    // redirect may immediately forward to a landing page — waitForURL
    // observes the transient "/" commit, so don't re-assert it after).
    await backButton.click();
    await page.waitForURL(`${baseURL}/`);
  });

  test('authenticated user can navigate to a nonexistent admin path', async ({ page, baseURL }) => {
    // Navigate to dev sign-in
    await page.goto('/dev-sign-in');

    // Lazy-loaded route — wait for the chunk to render (see above).
    const isDevMode = await page
      .getByText('DEV MODE')
      .waitFor({ state: 'visible', timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    if (!isDevMode) {
      test.skip();
      return;
    }

    // Sign in as Paul Ivers (admin)
    await page.locator('button:has-text("Paul Ivers")').click();
    await page.waitForURL(`${baseURL}/`);

    // Try to navigate to a nonexistent admin path
    await page.goto('/admin/nonexistent');

    // Should show 404 page (not unauthorized)
    await expect(page.locator('text=Page not found')).toBeVisible();

    // Should still have sidebar
    const sidebar = page.locator('nav');
    await expect(sidebar).toBeVisible();
  });
});
