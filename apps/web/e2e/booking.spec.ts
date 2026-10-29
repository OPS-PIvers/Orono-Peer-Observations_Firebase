import { type Page, expect, test } from '@playwright/test';

/**
 * Booking page privacy: an invitee reads their own slice of the window
 * (windowInviteViews, written by the onObservationWindowInviteViews trigger)
 * and only open or blocked slots, so a co-invitee's booking never reaches
 * their browser.
 *
 * Seeds one window straight into the Firestore emulator (the `owner` token
 * bypasses rules, like the Admin SDK), lets the Functions emulator's trigger
 * write the views, then opens each invitee's booking link.
 */

const PROJECT = 'demo-ops';
const FIRESTORE = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`;
const ONE = 'teacher.one@orono.k12.mn.us';
const TWO = 'teacher.two@orono.k12.mn.us';
const BUILDING = 'orono-high-school';

type Value =
  | { stringValue: string }
  | { integerValue: string }
  | { nullValue: null }
  | { timestampValue: string }
  | { arrayValue: { values: Value[] } }
  | { mapValue: { fields: Record<string, Value> } };

function toValue(v: unknown): Value {
  if (v === null) return { nullValue: null };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (typeof v === 'number') return { integerValue: String(v) };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  return { mapValue: { fields: toFields(v as Record<string, unknown>) } };
}
function toFields(o: Record<string, unknown>): Record<string, Value> {
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, toValue(v)]));
}

async function seedDoc(path: string, data: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${FIRESTORE}/${path}`, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: toFields(data) }),
  });
  if (!res.ok) throw new Error(`seed ${path}: ${String(res.status)} ${await res.text()}`);
}

function slot(slotId: string, periodName: string, hourUTC: number, bookedBy: string | null) {
  return {
    slotId,
    windowId: '',
    buildingId: BUILDING,
    dateYMD: '2099-01-05',
    dayTypeId: 'regular',
    periodId: slotId,
    periodName,
    startUTC: new Date(Date.UTC(2099, 0, 5, hourUTC)),
    endUTC: new Date(Date.UTC(2099, 0, 5, hourUTC + 1)),
    startMinute: (hourUTC - 6) * 60,
    status: bookedBy ? 'booked' : 'available',
    blockedReason: null,
    bookedBy,
    bookedAt: bookedBy ? new Date() : null,
    observationId: bookedBy ? 'obs-e2e-two' : null,
    generatedAt: new Date(),
  };
}

async function seedWindow(windowId: string): Promise<void> {
  const invitee = (email: string, token: string, bookedSlotId: string | null) => ({
    email,
    name: email,
    role: 'teacher',
    year: 2,
    buildings: [BUILDING],
    buildingId: BUILDING,
    inviteToken: token,
    inviteSentAt: null,
    bookedSlotId,
  });
  for (const [id, s] of [
    ['p1', slot('p1', 'Open Period', 15, null)],
    ['p2', slot('p2', 'Taken Period', 17, TWO)],
  ] as const) {
    await seedDoc(`observationWindows/${windowId}/slots/${id}`, { ...s, windowId });
  }
  await seedDoc(`observationWindows/${windowId}`, {
    windowId,
    observerEmail: 'pe.alpha@orono.k12.mn.us',
    observerName: 'E2E Observer',
    bookingMode: 'direct',
    invitedEmails: [ONE, TWO],
    invitees: [invitee(ONE, 'tok-one', null), invitee(TWO, 'tok-two', 'p2')],
    startDate: '2099-01-01',
    endDate: '2099-01-31',
    weekdaysIncluded: [1, 2, 3, 4, 5],
    perDayCap: null,
    dayCounts: {},
    peBusyIntervals: [],
    status: 'partially-booked',
    defaultObservationType: 'Standard',
  });
}

async function devSignIn(page: Page, email: string): Promise<void> {
  await page.goto('/dev-sign-in');
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
    if (process.env.CI) throw new Error('dev-auth-server / emulator backend not reachable');
    test.skip(true, 'dev-auth-server / emulator backend not reachable');
  }
}

/** Seeds a fresh window for this test, or skips when the emulator is down
 *  outside CI. */
async function freshWindow(): Promise<string> {
  const info = test.info();
  const windowId = `e2e-book-${info.project.name}-${String(info.workerIndex)}-${String(Date.now())}`;
  try {
    await seedWindow(windowId);
  } catch (err) {
    if (process.env.CI) throw err;
    test.skip(true, `Firestore emulator not reachable: ${String(err)}`);
  }
  return windowId;
}

test.describe('booking page', () => {
  test('an unbooked invitee sees open slots but not a co-invitee’s booking', async ({ page }) => {
    const windowId = await freshWindow();
    await devSignIn(page, ONE);
    await page.goto(`/book/${windowId}?token=tok-one`);

    // The view is written by a trigger, so it can trail the seed briefly.
    await expect(page.getByText('Invited by E2E Observer')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: /Open Period/ })).toBeVisible();
    await expect(page.getByText('Taken Period')).toHaveCount(0);
  });

  test('a booked invitee sees their own booked slot', async ({ page }) => {
    const windowId = await freshWindow();
    await devSignIn(page, TWO);
    await page.goto(`/book/${windowId}?token=tok-two`);

    await expect(page.getByText("You're booked.")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Taken Period/)).toBeVisible();
  });
});
