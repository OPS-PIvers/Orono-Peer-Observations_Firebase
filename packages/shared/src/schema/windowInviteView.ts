/**
 * Window invite view: `/windowInviteViews/{windowId}_{email}`, the part of an
 * observation window one invitee is allowed to read. Written only by the
 * `onObservationWindowInviteViews` trigger (and the backfillWindowInviteViews
 * job), never by clients.
 *
 * Why it exists: the window doc holds every invitee's entry (role, year,
 * buildings, invite token, booking), and rules gate whole documents, so an
 * invitee who could read the window would receive every co-invitee's entry.
 * The booking page and the staff dashboard read this view instead; it holds
 * the window settings booking needs plus the reader's own entries only.
 *
 * The projection is an allowlist: a window field not named below never
 * reaches an invitee.
 */

/** Window-level fields every invitee sees. `dayCounts` is a per-day total
 *  across invitees (no names), needed to show day-preference caps. */
export const WINDOW_INVITE_VIEW_FIELDS = [
  'observerEmail',
  'observerName',
  'bookingMode',
  'status',
  'startDate',
  'endDate',
  'weekdaysIncluded',
  'perDayCap',
  'dayCounts',
] as const;

/** Stored-doc defaults (as in the observationWindow schema) for the fields
 *  booking reads, so the view is complete even for a window written before
 *  a field existed. */
const VIEW_DEFAULTS: Partial<Record<(typeof WINDOW_INVITE_VIEW_FIELDS)[number], unknown>> = {
  observerName: '',
  weekdaysIncluded: [1, 2, 3, 4, 5],
  perDayCap: null,
  dayCounts: {},
};

/** One of the reader's own invite entries (a person invited at two
 *  buildings has two). */
export interface WindowInviteEntry {
  buildingId: string;
  inviteToken: string;
  bookedSlotId: string | null;
}

/** Shape the client reads. Window fields are as stored on the window. */
export interface WindowInviteView {
  windowId: string;
  email: string;
  observerEmail: string;
  observerName: string;
  bookingMode: 'direct' | 'day-preference';
  status: string;
  startDate: string;
  endDate: string;
  weekdaysIncluded: number[];
  perDayCap: number | null;
  dayCounts: Record<string, number>;
  entries: WindowInviteEntry[];
}

export function windowInviteViewId(windowId: string, email: string): string {
  return `${windowId}_${email.toLowerCase()}`;
}

function entryOf(raw: unknown): (WindowInviteEntry & { email: string }) | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const email: unknown = Reflect.get(raw, 'email');
  const buildingId: unknown = Reflect.get(raw, 'buildingId');
  const inviteToken: unknown = Reflect.get(raw, 'inviteToken');
  const bookedSlotId: unknown = Reflect.get(raw, 'bookedSlotId');
  if (typeof email !== 'string' || typeof buildingId !== 'string') return null;
  if (typeof inviteToken !== 'string') return null;
  return {
    email: email.toLowerCase(),
    buildingId,
    inviteToken,
    bookedSlotId: typeof bookedSlotId === 'string' ? bookedSlotId : null,
  };
}

/**
 * Projects raw window data (as read from Firestore, unvalidated) onto one
 * view per invited email, keyed by view doc id. Absent window fields take
 * their schema default where booking needs one and otherwise stay absent;
 * malformed invitee entries are dropped.
 */
export function windowInviteViewsOf(
  win: Record<string, unknown>,
  windowId: string,
): Map<string, Record<string, unknown>> {
  const base: Record<string, unknown> = { windowId };
  for (const field of WINDOW_INVITE_VIEW_FIELDS) {
    const value = win[field] ?? VIEW_DEFAULTS[field];
    if (value !== undefined) base[field] = value;
  }

  const byEmail = new Map<string, WindowInviteEntry[]>();
  const rawInvitees = win['invitees'];
  for (const raw of Array.isArray(rawInvitees) ? rawInvitees : []) {
    const entry = entryOf(raw);
    if (!entry) continue;
    const { email, ...own } = entry;
    byEmail.set(email, [...(byEmail.get(email) ?? []), own]);
  }

  const views = new Map<string, Record<string, unknown>>();
  for (const [email, entries] of byEmail) {
    views.set(windowInviteViewId(windowId, email), { ...base, email, entries });
  }
  return views;
}
