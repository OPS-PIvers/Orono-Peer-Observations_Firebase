import { Timestamp, type Firestore, type Transaction } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  OBSERVATION_SLOT_STATUS,
  OBSERVATION_WINDOW_STATUS,
  SLOT_BLOCKED_REASON,
  WINDOW_SUBCOLLECTIONS,
  type ObservationSlot,
  type ObservationWindow,
  type PeBusyInterval,
  type SchedulingSettings,
  type SlotBlockedReasonValue,
} from '@ops/shared';
import { peConflicts } from './timeWindows.js';
import { queryFreeBusy, type FreeBusyInterval } from '../../calendar/lib/googleCalendar.js';

const MAX_BATCH_WRITES = 450;

/**
 * `SLOT_BLOCKED_REASON` (the constants object consumed elsewhere) doesn't yet
 * carry the observer-busy value, so reference the schema enum value directly —
 * typed against the Zod-derived union so a future rename is a compile error.
 */
const OBSERVER_BUSY_REASON: SlotBlockedReasonValue = 'observer-busy';

/**
 * Window statuses whose bookings still occupy the evaluator's time — i.e. count
 * toward cross-window (sibling) conflicts. Cancelled / expired windows hold no
 * live bookings, so their ledgers are ignored.
 */
const ACTIVE_WINDOW_STATUSES: string[] = [
  OBSERVATION_WINDOW_STATUS.open,
  OBSERVATION_WINDOW_STATUS.partiallyBooked,
  OBSERVATION_WINDOW_STATUS.fullyBooked,
];

/** Coerce a Firestore Timestamp / Date / number into a Date. */
function toDate(value: unknown): Date {
  if (value instanceof Timestamp) return value.toDate();
  if (value instanceof Date) return value;
  if (typeof value === 'number') return new Date(value);
  return new Date(NaN);
}

/**
 * Coerce a stored busy ledger into `PeBusyInterval[]` with real `Date`
 * instants. Firestore returns the `startUTC` / `endUTC` fields as `Timestamp`s
 * at runtime even though the schema types them as `Date`; the pure
 * conflict helpers ({@link peConflicts}) call `.getTime()`, so they must be
 * normalized first. Returns a fresh array; the input is not mutated.
 */
export function normalizeLedger(ledger: readonly PeBusyInterval[]): PeBusyInterval[] {
  return ledger.map((iv) => ({
    slotId: iv.slotId,
    startUTC: toDate(iv.startUTC),
    endUTC: toDate(iv.endUTC),
  }));
}

/**
 * Map Google free/busy intervals into the `PeBusyInterval` shape the pure
 * conflict helpers consume. Each gets a synthetic, stable `slotId`
 * (`observer-busy-<index>`) so it never collides with a real slot's id (which
 * is always `building-date-period`). Pure — no I/O.
 */
export function freeBusyToIntervals(busy: readonly FreeBusyInterval[]): PeBusyInterval[] {
  return busy.map((b, i) => ({
    slotId: `observer-busy-${i.toString()}`,
    startUTC: b.start,
    endUTC: b.end,
  }));
}

/**
 * Resolve the observer's calendar busy intervals for a window, or `null` when
 * availability sync should be skipped.
 *
 * Returns `null` (skip — leave any existing `observer-busy` slots untouched)
 * when the toggle is off, the observer hasn't connected a calendar, or the
 * connection lacks the freebusy scope. Returns an array (possibly empty) only
 * when the calendar was actually consulted — an empty array means "checked,
 * the evaluator is free across the whole window".
 *
 * Best-effort: any error inside {@link queryFreeBusy} surfaces as `null`.
 */
export async function observerBusyForWindow(
  window: ObservationWindow,
  scheduling: SchedulingSettings,
): Promise<PeBusyInterval[] | null> {
  if (!scheduling.checkObserverCalendar) return null;

  // Bound the query to the window's calendar dates. The exact day-boundary
  // instants don't have to be timezone-perfect — overshooting by a few hours
  // only widens the busy scan, never narrows it, and conflict math is on the
  // absolute slot instants anyway.
  const [sy, sm, sd] = window.startDate.split('-').map(Number) as [number, number, number];
  const [ey, em, ed] = window.endDate.split('-').map(Number) as [number, number, number];
  const timeMin = new Date(Date.UTC(sy, sm - 1, sd, 0, 0, 0) - 12 * 60 * 60 * 1000);
  const timeMax = new Date(Date.UTC(ey, em - 1, ed, 23, 59, 59) + 12 * 60 * 60 * 1000);

  const busy = await queryFreeBusy(window.observerEmail, timeMin, timeMax);
  if (busy === null) return null;
  return freeBusyToIntervals(busy);
}

/** The desired blocked state of a reconsiderable slot. */
export interface SlotBlockingState {
  status: typeof OBSERVATION_SLOT_STATUS.available | typeof OBSERVATION_SLOT_STATUS.blocked;
  blockedReason: SlotBlockedReasonValue | null;
}

/**
 * Pure resolver: what blocking state should a reconsiderable slot have?
 *
 * Precedence: an in-app PE booking (`pe-conflict`) wins over a calendar event
 * (`observer-busy`), since the former is authoritative for this app. When
 * `observerBusy` is `null` the observer-calendar dimension is ignored entirely
 * (skip mode) — callers that didn't consult the calendar pass `null` so they
 * never clobber an existing `observer-busy` mark.
 *
 * Returns the target `{ status, blockedReason }`; the caller compares against
 * the slot's current state to decide whether a write is needed.
 */
export function resolveSlotBlocking(
  slotStartUTC: Date,
  slotEndUTC: Date,
  slotId: string,
  peBusy: PeBusyInterval[],
  observerBusy: PeBusyInterval[] | null,
  bufferMinutes: number,
): SlotBlockingState {
  if (peConflicts(slotStartUTC, slotEndUTC, peBusy, bufferMinutes, slotId)) {
    return {
      status: OBSERVATION_SLOT_STATUS.blocked,
      blockedReason: SLOT_BLOCKED_REASON.peConflict,
    };
  }
  // Observer calendar conflicts use a zero buffer: a real meeting only blocks
  // the periods it actually overlaps, not buffer-padded neighbors.
  if (observerBusy !== null && peConflicts(slotStartUTC, slotEndUTC, observerBusy, 0)) {
    return { status: OBSERVATION_SLOT_STATUS.blocked, blockedReason: OBSERVER_BUSY_REASON };
  }
  return { status: OBSERVATION_SLOT_STATUS.available, blockedReason: null };
}

/**
 * Recompute conflict blocking for every reconsiderable slot in a window.
 *
 * For each slot that is currently `available`, blocked for `pe-conflict`, or
 * (when `observerBusy` is supplied) blocked for `observer-busy`, flip it to the
 * state {@link resolveSlotBlocking} computes from the window's
 * `peBusyIntervals` (± travel buffer) and the observer's calendar busy
 * intervals.
 *
 * `observerBusy`:
 *   - `undefined`/`null` — skip the calendar dimension entirely; existing
 *     `observer-busy` slots are left untouched (not reconsiderable). Legacy
 *     callers (book / cancel / assign / schedule-change) pass nothing.
 *   - an array (possibly empty) — the calendar was consulted; `observer-busy`
 *     slots are reconsidered and re-opened when no longer busy.
 *
 * `booked` slots and slots blocked for `no-school` / `window-cancelled` are
 * never touched. Writes are batched (≤450 per batch).
 */
export async function recomputeBlockedSlots(
  db: Firestore,
  windowId: string,
  observerBusy: PeBusyInterval[] | null = null,
): Promise<void> {
  const windowRef = db.collection(COLLECTIONS.observationWindows).doc(windowId);
  const windowSnap = await windowRef.get();
  if (!windowSnap.exists) return;
  const window = windowSnap.data() as ObservationWindow;

  const peBusy = window.peBusyIntervals.map((iv) => ({
    slotId: iv.slotId,
    startUTC: toDate(iv.startUTC),
    endUTC: toDate(iv.endUTC),
  }));
  const bufferMinutes = window.travelBufferMinutes;
  const checkObserver = observerBusy !== null;

  const slotsSnap = await windowRef.collection(WINDOW_SUBCOLLECTIONS.slots).get();

  interface Update {
    ref: FirebaseFirestore.DocumentReference;
    data: Record<string, unknown>;
  }
  const updates: Update[] = [];

  for (const slotDoc of slotsSnap.docs) {
    const slot = slotDoc.data() as ObservationSlot;

    const reconsiderable =
      slot.status === OBSERVATION_SLOT_STATUS.available ||
      (slot.status === OBSERVATION_SLOT_STATUS.blocked &&
        (slot.blockedReason === SLOT_BLOCKED_REASON.peConflict ||
          (checkObserver && slot.blockedReason === OBSERVER_BUSY_REASON)));
    if (!reconsiderable) continue;

    const target = resolveSlotBlocking(
      toDate(slot.startUTC),
      toDate(slot.endUTC),
      slot.slotId,
      peBusy,
      observerBusy,
      bufferMinutes,
    );

    if (slot.status !== target.status || slot.blockedReason !== target.blockedReason) {
      updates.push({
        ref: slotDoc.ref,
        data: { status: target.status, blockedReason: target.blockedReason },
      });
    }
  }

  for (let i = 0; i < updates.length; i += MAX_BATCH_WRITES) {
    const batch = db.batch();
    for (const u of updates.slice(i, i + MAX_BATCH_WRITES)) {
      batch.update(u.ref, u.data);
    }
    await batch.commit();
  }
}

/**
 * Read the busy intervals booked in every *other* active window owned by the
 * same evaluator, inside an open transaction.
 *
 * Used when rescheduling: the evaluator's time is shared across all their
 * windows, so a reschedule target must be checked against sibling-window
 * bookings too — not just the current window's own ledger. The query runs
 * through `tx.get` so the read participates in the transaction's snapshot, and
 * the current window (`excludeWindowId`) is filtered out. Intervals are
 * normalized to `Date` instants so the pure conflict helpers can consume them.
 */
export async function siblingBusyIntervalsInTx(
  db: Firestore,
  tx: Transaction,
  observerEmail: string,
  excludeWindowId: string,
): Promise<PeBusyInterval[]> {
  const query = db
    .collection(COLLECTIONS.observationWindows)
    .where('observerEmail', '==', observerEmail)
    .where('status', 'in', ACTIVE_WINDOW_STATUSES);
  const snap = await tx.get(query);

  const intervals: PeBusyInterval[] = [];
  for (const doc of snap.docs) {
    if (doc.id === excludeWindowId) continue;
    const window = doc.data() as ObservationWindow;
    intervals.push(...normalizeLedger(window.peBusyIntervals));
  }
  return intervals;
}

/**
 * Recompute pe-conflict blocking for every active window this evaluator owns.
 *
 * After a reschedule frees one slot and books another, conflicting slots in
 * *sibling* windows must be re-evaluated too (the freed time may re-open a slot
 * elsewhere; the newly-booked time may block one). Best-effort per window — a
 * single window's recompute failure is logged by the caller, not propagated, so
 * one bad window can't strand the others.
 */
export async function recomputeBlockedSlotsForObserver(
  db: Firestore,
  observerEmail: string,
): Promise<void> {
  const snap = await db
    .collection(COLLECTIONS.observationWindows)
    .where('observerEmail', '==', observerEmail)
    .where('status', 'in', ACTIVE_WINDOW_STATUSES)
    .get();

  for (const doc of snap.docs) {
    await recomputeBlockedSlots(db, doc.id);
  }
}
