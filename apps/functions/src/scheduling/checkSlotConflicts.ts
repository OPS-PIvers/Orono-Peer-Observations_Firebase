import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  OBSERVATION_SLOT_STATUS,
  WINDOW_SUBCOLLECTIONS,
  checkSlotConflictsInput,
  type CheckSlotConflictsResult,
  type ObservationSlot,
  type ObservationWindow,
} from '@ops/shared';
import {
  GOOGLE_OAUTH_CLIENT_SECRET,
  overlapsBusy,
  queryFreeBusy,
} from '../calendar/lib/googleCalendar.js';
import { loadSchedulingSettings } from './bookObservationSlot.js';
import { toDate } from './engine/schedulingEmail.js';

if (getApps().length === 0) initializeApp();

/**
 * Report which of a window's still-available slots (for the caller's
 * building) collide with busy time on the EVALUATOR'S real Google Calendar,
 * so the booking UI can badge them before the user picks one.
 *
 * Read-only and invitee-scoped: the caller must present the same invite
 * token that booking itself requires, and the response contains only slot
 * ids — never any calendar event detail. `checked:false` means the lookup
 * could not run (conflict policy 'ignore', evaluator calendar not connected,
 * or a freebusy API error) — the UI shows no badges rather than guessing.
 */
export const checkSlotConflicts = onCall(
  {
    region: 'us-central1',
    memory: '256MiB',
    timeoutSeconds: 30,
    secrets: [GOOGLE_OAUTH_CLIENT_SECRET],
  },
  async (request): Promise<CheckSlotConflictsResult> => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required');
    const userEmail = request.auth.token.email?.toLowerCase();
    if (!userEmail) throw new HttpsError('unauthenticated', 'Token has no email');

    const parsed = checkSlotConflictsInput.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError('invalid-argument', parsed.error.issues[0]?.message ?? 'Invalid input');
    }
    const input = parsed.data;

    const db = getFirestore();
    const scheduling = await loadSchedulingSettings(db);
    if (scheduling.gcalConflictPolicy === 'ignore') {
      return { checked: false, conflictedSlotIds: [] };
    }

    const windowSnap = await db
      .collection(COLLECTIONS.observationWindows)
      .doc(input.windowId)
      .get();
    if (!windowSnap.exists) throw new HttpsError('not-found', 'Window not found');
    const window = windowSnap.data() as ObservationWindow;

    const invitee = window.invitees.find(
      (inv) => inv.email === userEmail && inv.inviteToken === input.inviteToken,
    );
    if (!invitee) {
      throw new HttpsError('permission-denied', 'Invalid invite token for this user');
    }

    const slotsSnap = await db
      .collection(COLLECTIONS.observationWindows)
      .doc(input.windowId)
      .collection(WINDOW_SUBCOLLECTIONS.slots)
      .where('buildingId', '==', invitee.buildingId)
      .get();

    // Only slots the invitee could actually pick need checking.
    const candidates: { slotId: string; startMs: number; endMs: number }[] = [];
    for (const doc of slotsSnap.docs) {
      const slot = doc.data() as ObservationSlot;
      if (slot.status !== OBSERVATION_SLOT_STATUS.available) continue;
      const start = toDate(slot.startUTC);
      const end = toDate(slot.endUTC);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue;
      candidates.push({ slotId: slot.slotId, startMs: start.getTime(), endMs: end.getTime() });
    }
    if (candidates.length === 0) {
      return { checked: false, conflictedSlotIds: [] };
    }

    // One freebusy query spanning every candidate slot, then local overlap math.
    const minStartMs = Math.min(...candidates.map((c) => c.startMs));
    const maxEndMs = Math.max(...candidates.map((c) => c.endMs));
    const busy = await queryFreeBusy(
      window.observerEmail,
      new Date(minStartMs),
      new Date(maxEndMs),
    );
    if (busy === null) {
      return { checked: false, conflictedSlotIds: [] };
    }

    const conflictedSlotIds = candidates
      .filter((c) => overlapsBusy(c.startMs, c.endMs, busy))
      .map((c) => c.slotId);

    return { checked: true, conflictedSlotIds };
  },
);
