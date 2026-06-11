import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions';
import { getApps, initializeApp } from 'firebase-admin/app';
import {
  FieldValue,
  Timestamp,
  getFirestore,
  type DocumentReference,
  type Firestore,
} from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  OBSERVATION_SLOT_STATUS,
  OBSERVATION_STATUS,
  OBSERVATION_WINDOW_STATUS,
  SLOT_BLOCKED_REASON,
  WINDOW_SUBCOLLECTIONS,
  type Building,
  type BuildingSchedule,
  type Observation,
  type ObservationSlot,
  type ObservationWindow,
  type SchedulingSettings,
  type Staff,
} from '@ops/shared';
import { generateSlotsForWindow, type SlotInput } from './engine/slotGeneration.js';
import { loadSchedulingSettings } from './bookObservationSlot.js';
import { cancelBookingForSlot } from './cancelBooking.js';
import { recomputeBlockedSlots } from './engine/blocking.js';
import { formatChicagoDate, formatChicagoTime } from './engine/schedulingEmail.js';
import { sendTemplatedEmail } from '../lib/emailUtils.js';
import {
  GOOGLE_OAUTH_CLIENT_SECRET,
  updateObservationEvent,
} from '../calendar/lib/googleCalendar.js';

if (getApps().length === 0) initializeApp();

const MAX_BATCH_WRITES = 450;

/** Today's calendar date in Chicago as YYYY-MM-DD. */
function chicagoToday(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(now);
}

/**
 * What reconciling a building schedule does to a *booked* slot, decided purely
 * from the old slot + the newly-generated slot (or its absence). Extracted so
 * the decision can be unit-tested without Firestore.
 *
 *   - `null`          — the period is unchanged; leave the booking alone.
 *   - `time-changed`  — the period still exists but its wall-clock moved; the
 *                       booking, observation, and calendar events must follow.
 *   - `period-removed`— the period no longer generates (no-school / removed);
 *                       the booking must be cancelled so the invitee can rebook.
 */
export type BookedSlotReconcileAction =
  | { kind: 'time-changed'; slotId: string; want: SlotInput }
  | { kind: 'period-removed'; slotId: string };

/** Coerce a Firestore Timestamp / Date / number into a JS Date. */
function toDate(value: unknown): Date {
  if (value instanceof Timestamp) return value.toDate();
  if (value instanceof Date) return value;
  if (typeof value === 'number') return new Date(value);
  return new Date(NaN);
}

/**
 * Decide how a booked slot should be reconciled against its regenerated
 * counterpart. `want` is the freshly-generated slot for the same id, or
 * `undefined` when the period no longer generates.
 */
export function classifyBookedSlot(
  slot: Pick<ObservationSlot, 'slotId' | 'startUTC' | 'endUTC' | 'startMinute'>,
  want: SlotInput | undefined,
): BookedSlotReconcileAction | null {
  if (!want) return { kind: 'period-removed', slotId: slot.slotId };
  const startChanged = toDate(slot.startUTC).getTime() !== want.startUTC.getTime();
  const endChanged = toDate(slot.endUTC).getTime() !== want.endUTC.getTime();
  if (startChanged || endChanged || slot.startMinute !== want.startMinute) {
    return { kind: 'time-changed', slotId: slot.slotId, want };
  }
  return null;
}

/**
 * Re-generate this building's slots for every affected active window when its
 * bell schedule changes.
 *
 * For each `open`/`partially-booked` window that has an invitee in this
 * building and whose date range is today-or-later:
 *   - add slots that are now generated but don't yet exist;
 *   - flip existing AVAILABLE slots that are no longer generated (now
 *     no-school) to `blocked`/`no-school`;
 *   - flip previously no-school-blocked slots that exist again back to
 *     `available`;
 *   - for `booked` slots whose period TIME changed, move the booking in place
 *     (slot + observation + calendar events) and email both parties;
 *   - for `booked` slots whose period VANISHED, cancel the booking (freeing the
 *     invitee to rebook) and email both parties.
 *
 * Best-effort: each window is wrapped in its own try/catch so one failure
 * doesn't abort the rest.
 */
export const onBuildingScheduleWritten = onDocumentWritten(
  {
    document: 'buildingSchedules/{buildingId}',
    region: 'us-central1',
    memory: '512MiB',
    timeoutSeconds: 300,
    secrets: [GOOGLE_OAUTH_CLIENT_SECRET],
  },
  async (event) => {
    const buildingId = event.params.buildingId;
    const afterSnap = event.data?.after;
    if (!afterSnap?.exists) {
      // Schedule deleted — leave existing slots as-is for active windows.
      logger.info('onBuildingScheduleWritten: schedule deleted, no slot regen', { buildingId });
      return;
    }
    const schedule = afterSnap.data() as BuildingSchedule;

    const db = getFirestore();
    const today = chicagoToday(new Date());
    const scheduling = await loadSchedulingSettings(db);

    const snap = await db
      .collection(COLLECTIONS.observationWindows)
      .where('status', 'in', [
        OBSERVATION_WINDOW_STATUS.open,
        OBSERVATION_WINDOW_STATUS.partiallyBooked,
      ])
      .get();

    for (const windowDoc of snap.docs) {
      const window = windowDoc.data() as ObservationWindow;
      // Only windows that invite someone in this building and aren't fully past.
      const involvesBuilding = window.invitees.some((inv) => inv.buildingId === buildingId);
      if (!involvesBuilding) continue;
      if (window.endDate < today) continue;

      try {
        await reconcileWindow(db, windowDoc.ref, window, buildingId, schedule, today, scheduling);
      } catch (err) {
        logger.error('onBuildingScheduleWritten: window reconcile failed', {
          buildingId,
          windowId: windowDoc.id,
          err,
        });
      }
    }
  },
);

async function reconcileWindow(
  db: Firestore,
  windowRef: DocumentReference,
  window: ObservationWindow,
  buildingId: string,
  schedule: BuildingSchedule,
  today: string,
  scheduling: SchedulingSettings,
): Promise<void> {
  // Generate the desired slot set for THIS building only.
  const singleBuildingWindow: ObservationWindow = {
    ...window,
    invitees: window.invitees.filter((inv) => inv.buildingId === buildingId),
  };
  const schedulesByBuilding = new Map<string, BuildingSchedule>([[buildingId, schedule]]);
  const desired = generateSlotsForWindow(singleBuildingWindow, schedulesByBuilding);
  const desiredById = new Map<string, SlotInput>();
  for (const s of desired) desiredById.set(s.slotId, s);

  // Load existing slots for this building (only today-or-later are eligible
  // for regen — past dates are immutable history).
  const slotsCol = windowRef.collection(WINDOW_SUBCOLLECTIONS.slots);
  const existingSnap = await slotsCol.where('buildingId', '==', buildingId).get();
  const existingById = new Map<string, { ref: DocumentReference; slot: ObservationSlot }>();
  for (const d of existingSnap.docs) {
    existingById.set(d.id, { ref: d.ref, slot: d.data() as ObservationSlot });
  }

  const now = FieldValue.serverTimestamp();
  type Write =
    | { kind: 'set'; ref: DocumentReference; data: Record<string, unknown> }
    | { kind: 'update'; ref: DocumentReference; data: Record<string, unknown> };
  const writes: Write[] = [];
  // Booked slots that the schedule change touched — handled (with side effects:
  // observation/calendar/email) AFTER the available-slot batch commits, since
  // those flows run their own transactions and best-effort I/O.
  const bookedActions: BookedSlotReconcileAction[] = [];

  // 1. Desired slots: add missing, restore no-school-blocked, reconcile booked.
  for (const want of desired) {
    if (want.dateYMD < today) continue; // never touch past
    const existing = existingById.get(want.slotId);
    if (!existing) {
      writes.push({
        kind: 'set',
        ref: slotsCol.doc(want.slotId),
        data: { ...want, generatedAt: now },
      });
      continue;
    }
    const slot = existing.slot;
    if (slot.status === OBSERVATION_SLOT_STATUS.booked) {
      const action = classifyBookedSlot(slot, want);
      if (action) bookedActions.push(action);
      continue; // booked slots are reconciled out-of-band below
    }
    // Restore a previously no-school-blocked slot that's generated again.
    if (
      slot.status === OBSERVATION_SLOT_STATUS.blocked &&
      slot.blockedReason === SLOT_BLOCKED_REASON.noSchool
    ) {
      writes.push({
        kind: 'update',
        ref: existing.ref,
        data: {
          status: OBSERVATION_SLOT_STATUS.available,
          blockedReason: null,
          startUTC: want.startUTC,
          endUTC: want.endUTC,
          startMinute: want.startMinute,
          periodName: want.periodName,
          dayTypeId: want.dayTypeId,
        },
      });
    } else if (slot.status === OBSERVATION_SLOT_STATUS.available) {
      // Keep available slots in sync with any time/name changes.
      const startChanged = toDate(slot.startUTC).getTime() !== want.startUTC.getTime();
      const endChanged = toDate(slot.endUTC).getTime() !== want.endUTC.getTime();
      if (startChanged || endChanged || slot.startMinute !== want.startMinute) {
        writes.push({
          kind: 'update',
          ref: existing.ref,
          data: {
            startUTC: want.startUTC,
            endUTC: want.endUTC,
            startMinute: want.startMinute,
            periodName: want.periodName,
            dayTypeId: want.dayTypeId,
          },
        });
      }
    }
  }

  // 2. Existing slots no longer desired: AVAILABLE → blocked/no-school.
  //    Booked → cancel. (no-school already blocked: leave as-is.)
  for (const [slotId, { ref, slot }] of existingById) {
    if (slot.dateYMD < today) continue;
    if (desiredById.has(slotId)) continue;
    if (slot.status === OBSERVATION_SLOT_STATUS.booked) {
      bookedActions.push({ kind: 'period-removed', slotId });
      continue;
    }
    if (slot.status === OBSERVATION_SLOT_STATUS.available) {
      writes.push({
        kind: 'update',
        ref,
        data: {
          status: OBSERVATION_SLOT_STATUS.blocked,
          blockedReason: SLOT_BLOCKED_REASON.noSchool,
        },
      });
    }
  }

  for (let i = 0; i < writes.length; i += MAX_BATCH_WRITES) {
    const batch = db.batch();
    for (const w of writes.slice(i, i + MAX_BATCH_WRITES)) {
      if (w.kind === 'set') batch.set(w.ref, w.data);
      else batch.update(w.ref, w.data);
    }
    await batch.commit();
  }

  // 3. Reconcile booked slots affected by the schedule change. Each is
  //    best-effort and isolated so one failure doesn't abort the rest.
  for (const action of bookedActions) {
    try {
      if (action.kind === 'time-changed') {
        await applyBookedSlotTimeChange(db, windowRef, action.want, scheduling);
      } else {
        await cancelBookingForSlot({
          db,
          scheduling,
          windowId: window.windowId,
          slotId: action.slotId,
          reason:
            'A bell-schedule change removed the period this observation was booked in. Please pick a new time.',
          initiatedBy: 'system',
        });
      }
    } catch (err) {
      logger.error('onBuildingScheduleWritten: booked-slot reconcile failed', {
        windowId: window.windowId,
        buildingId,
        slotId: action.slotId,
        kind: action.kind,
        err,
      });
      // Fall back to the prior behaviour for this slot: an audit warning so the
      // change is never silently lost.
      await db
        .collection(COLLECTIONS.auditLog)
        .add({
          timestamp: FieldValue.serverTimestamp(),
          userEmail: 'system',
          action: 'observationWindow.scheduleChangeWarning',
          target: `${COLLECTIONS.observationWindows}/${window.windowId}`,
          details: {
            buildingId,
            bookedSlotIssues: [{ slotId: action.slotId, issue: action.kind }],
          },
        })
        .catch((auditErr: unknown) =>
          logger.error('onBuildingScheduleWritten: fallback audit write failed', auditErr),
        );
    }
  }
}

/**
 * Move a booked slot's wall-clock in place after its period time changed:
 * update the slot's startUTC/endUTC/startMinute/periodName, rewrite the
 * matching `peBusyIntervals` entry, repoint the still-Draft observation's
 * scheduled times, patch both Google Calendar events, and email both parties.
 *
 * Runs the slot + window + observation moves in a transaction (re-reading the
 * slot so a concurrent cancel/reschedule can't be clobbered), then does the
 * calendar patch + email best-effort.
 */
async function applyBookedSlotTimeChange(
  db: Firestore,
  windowRef: DocumentReference,
  want: SlotInput,
  scheduling: SchedulingSettings,
): Promise<void> {
  const slotRef = windowRef.collection(WINDOW_SUBCOLLECTIONS.slots).doc(want.slotId);
  const newStart = want.startUTC;
  const newEnd = want.endUTC;

  let movedWindow: ObservationWindow | null = null;
  let movedSlot: ObservationSlot | null = null;
  let movedObservationId: string | null = null;
  let movedStaffEmail: string | null = null;

  await db.runTransaction(async (tx) => {
    const slotSnap = await tx.get(slotRef);
    if (!slotSnap.exists) return; // slot vanished — nothing to move
    const slot = slotSnap.data() as ObservationSlot;
    if (slot.status !== OBSERVATION_SLOT_STATUS.booked) return; // no longer booked

    const windowSnap = await tx.get(windowRef);
    if (!windowSnap.exists) return;
    const window = windowSnap.data() as ObservationWindow;

    const observationId = slot.observationId ?? null;

    // Repoint the still-Draft observation so its scheduled time and date follow
    // the new period. A Finalized observation keeps its frozen times.
    let obsRef: DocumentReference | null = null;
    let moveObservation = false;
    if (observationId) {
      obsRef = db.collection(COLLECTIONS.observations).doc(observationId);
      const obsSnap = await tx.get(obsRef);
      if (obsSnap.exists) {
        const obs = obsSnap.data() as Observation;
        moveObservation = obs.status !== OBSERVATION_STATUS.finalized;
      } else {
        obsRef = null;
      }
    }

    // Writes (all reads above are done).
    tx.update(slotRef, {
      startUTC: Timestamp.fromDate(newStart),
      endUTC: Timestamp.fromDate(newEnd),
      startMinute: want.startMinute,
      periodName: want.periodName,
      dayTypeId: want.dayTypeId,
    });

    // Rewrite the matching ledger interval to the new instant.
    const nextLedger = window.peBusyIntervals.map((iv) =>
      iv.slotId === slot.slotId
        ? {
            slotId: iv.slotId,
            startUTC: Timestamp.fromDate(newStart),
            endUTC: Timestamp.fromDate(newEnd),
          }
        : iv,
    );
    tx.update(windowRef, {
      peBusyIntervals: nextLedger,
      updatedAt: FieldValue.serverTimestamp(),
    });

    if (obsRef && moveObservation) {
      tx.update(obsRef, {
        scheduledStartAt: Timestamp.fromDate(newStart),
        scheduledEndAt: Timestamp.fromDate(newEnd),
        observationDate: Timestamp.fromDate(newStart),
        lastModifiedAt: FieldValue.serverTimestamp(),
      });
    }

    movedWindow = window;
    movedSlot = slot;
    movedObservationId = observationId;
    movedStaffEmail = slot.bookedBy ?? null;
  });

  const window = movedWindow as ObservationWindow | null;
  const slot = movedSlot as ObservationSlot | null;
  if (!window || !slot) return; // nothing moved (concurrent change)
  const staffEmail = movedStaffEmail as string | null;
  const observationId = movedObservationId as string | null;

  // The freed/occupied instants changed — recompute blocking so sibling slots
  // re-open or re-block around the new time. Best-effort.
  await recomputeBlockedSlots(db, window.windowId).catch((err: unknown) =>
    logger.error('onBuildingScheduleWritten: recomputeBlockedSlots failed', err),
  );

  // Patch the Google Calendar events to the new time (best-effort).
  if (observationId && staffEmail) {
    try {
      const obsSnap = await db.collection(COLLECTIONS.observations).doc(observationId).get();
      const obs = obsSnap.exists ? (obsSnap.data() as Observation) : null;
      const eventIds = obs?.gcalEventIds ?? {};
      const sendUpdates: 'none' | 'all' = window.gcalSendUpdates === 'all' ? 'all' : 'none';
      const patch = {
        start: { dateTime: newStart.toISOString() },
        end: { dateTime: newEnd.toISOString() },
      };
      await Promise.all([
        eventIds.observer
          ? updateObservationEvent(window.observerEmail, eventIds.observer, patch, sendUpdates)
          : Promise.resolve(),
        eventIds.observed
          ? updateObservationEvent(staffEmail, eventIds.observed, patch, sendUpdates)
          : Promise.resolve(),
      ]);
    } catch (err) {
      logger.error('onBuildingScheduleWritten: calendar patch failed (non-fatal)', err);
    }
  }

  // Notify both parties their booked time moved (best-effort). Gated on the
  // same setting as booking confirmations.
  if (scheduling.confirmationEmailEnabled && staffEmail) {
    let buildingName = slot.buildingId;
    let observedName = staffEmail;
    try {
      const [bSnap, sSnap] = await Promise.all([
        db.collection(COLLECTIONS.buildings).doc(slot.buildingId).get(),
        db.collection(COLLECTIONS.staff).doc(staffEmail).get(),
      ]);
      if (bSnap.exists) buildingName = (bSnap.data() as Building).displayName;
      if (sSnap.exists) observedName = (sSnap.data() as Staff).name;
    } catch (err) {
      logger.warn('onBuildingScheduleWritten: lookup failed', err);
    }

    await sendTemplatedEmail({
      db,
      triggerType: 'scheduling.bookingTimeChanged',
      to: [staffEmail, window.observerEmail].filter(Boolean),
      vars: {
        observerName: window.observerName,
        observerEmail: window.observerEmail,
        observedName,
        observedEmail: staffEmail,
        slotDateLocal: formatChicagoDate(newStart),
        slotStartLocal: formatChicagoTime(newStart),
        slotEndLocal: formatChicagoTime(newEnd),
        slotPeriodName: want.periodName,
        buildingName,
      },
      mailDocId: `scheduling.bookingTimeChanged-${window.windowId}-${want.slotId}-${Date.now().toString()}`,
      auditDetails: {
        windowId: window.windowId,
        slotId: want.slotId,
        observationId,
        triggerType: 'scheduling.bookingTimeChanged',
      },
    }).catch((err: unknown) =>
      logger.error('onBuildingScheduleWritten: time-changed email send failed', err),
    );
  }

  // Audit the in-place move (mirrors the `slot_rescheduled` literal used by the
  // manual reschedule callable, with a system initiator).
  await db.collection(COLLECTIONS.auditLog).add({
    timestamp: FieldValue.serverTimestamp(),
    userEmail: 'system',
    action: 'slot_rescheduled',
    target: `${COLLECTIONS.observationWindows}/${window.windowId}/${WINDOW_SUBCOLLECTIONS.slots}/${want.slotId}`,
    details: {
      windowId: window.windowId,
      slotId: want.slotId,
      observationId,
      reason: 'bell-schedule-change',
    },
  });
}
