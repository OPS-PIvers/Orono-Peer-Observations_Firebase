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
  OBSERVATION_WINDOW_STATUS,
  SLOT_BLOCKED_REASON,
  WINDOW_SUBCOLLECTIONS,
  type BuildingSchedule,
  type ObservationSlot,
  type ObservationWindow,
} from '@ops/shared';
import { generateSlotsForWindow, type SlotInput } from './engine/slotGeneration.js';

if (getApps().length === 0) initializeApp();

const MAX_BATCH_WRITES = 450;

/** Today's calendar date in Chicago as YYYY-MM-DD. */
function chicagoToday(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(now);
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
 *   - never modify `booked` slots — instead, if a booked slot's period
 *     vanished or its time changed, write an auditLog warning.
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
        await reconcileWindow(db, windowDoc.ref, window, buildingId, schedule, today);
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

function toDate(value: unknown): Date {
  if (value instanceof Timestamp) return value.toDate();
  if (value instanceof Date) return value;
  if (typeof value === 'number') return new Date(value);
  return new Date(NaN);
}

async function reconcileWindow(
  db: Firestore,
  windowRef: DocumentReference,
  window: ObservationWindow,
  buildingId: string,
  schedule: BuildingSchedule,
  today: string,
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
  const bookedWarnings: { slotId: string; issue: string }[] = [];

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
      // Warn if the period's wall-clock changed under a booking.
      const startChanged = toDate(slot.startUTC).getTime() !== want.startUTC.getTime();
      const endChanged = toDate(slot.endUTC).getTime() !== want.endUTC.getTime();
      if (startChanged || endChanged || slot.startMinute !== want.startMinute) {
        bookedWarnings.push({ slotId: slot.slotId, issue: 'period-time-changed' });
      }
      continue; // never modify booked
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
  //    Booked → warn. (no-school already blocked: leave as-is.)
  for (const [slotId, { ref, slot }] of existingById) {
    if (slot.dateYMD < today) continue;
    if (desiredById.has(slotId)) continue;
    if (slot.status === OBSERVATION_SLOT_STATUS.booked) {
      bookedWarnings.push({ slotId, issue: 'period-removed' });
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

  if (bookedWarnings.length > 0) {
    await db.collection(COLLECTIONS.auditLog).add({
      timestamp: now,
      userEmail: 'system',
      action: 'observationWindow.scheduleChangeWarning',
      target: `${COLLECTIONS.observationWindows}/${window.windowId}`,
      details: { buildingId, bookedSlotIssues: bookedWarnings },
    });
    logger.warn('onBuildingScheduleWritten: booked slots affected by schedule change', {
      windowId: window.windowId,
      buildingId,
      bookedWarnings,
    });
  }
}
