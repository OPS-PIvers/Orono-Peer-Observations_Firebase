import { randomBytes } from 'node:crypto';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  OBSERVATION_WINDOW_STATUS,
  WINDOW_SUBCOLLECTIONS,
  isAdminRole,
  updateObservationWindowInput,
  type Building,
  type BuildingSchedule,
  type ObservationPreference,
  type ObservationWindow,
  type Staff,
  type WindowInvitee,
} from '@ops/shared';
import { APP_URL, sendTemplatedEmail } from '../lib/emailUtils.js';
import { generateSlotsForWindow } from './engine/slotGeneration.js';
import { recomputeBlockedSlots } from './engine/blocking.js';
import { formatYMD } from './engine/schedulingEmail.js';
import { loadSchedulingSettings, nextWindowStatus } from './bookObservationSlot.js';

if (getApps().length === 0) initializeApp();

const MAX_BATCH_WRITES = 450;

/** Today's calendar date in Chicago as YYYY-MM-DD (mirrors expireObservationWindows). */
function chicagoToday(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(now);
}

/**
 * Edit an observation window after creation.
 *
 * Allowed for an admin or the window's own observer (same rule as cancel).
 * Supports, in one call:
 *   - extending `endDate` (never shrinking — existing bookings stay valid),
 *   - adding invitees (resolved from /staff, minted a fresh invite token,
 *     emailed like at creation),
 *   - removing invitees who have not booked yet (their day preference, if
 *     any, is deleted and the day-count freed),
 *   - resending the invite email to un-booked invitees.
 *
 * Missing slots (new dates from an extension, new buildings from added
 * invitees) are topped up with the same deterministic generator used at
 * creation; existing slots — including every booking — are never touched.
 * Extending an `expired` window past today re-opens it.
 */
export const updateObservationWindow = onCall(
  { region: 'us-central1', memory: '512MiB', timeoutSeconds: 120 },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required');
    const userEmail = request.auth.token.email?.toLowerCase();
    if (!userEmail) throw new HttpsError('unauthenticated', 'Token has no email');

    const parsed = updateObservationWindowInput.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError('invalid-argument', parsed.error.issues[0]?.message ?? 'Invalid input');
    }
    const input = parsed.data;

    const removeEmails = [...new Set(input.removeInviteeEmails.map((e) => e.toLowerCase()))];
    const resendEmails = [...new Set(input.resendInviteEmails.map((e) => e.toLowerCase()))];
    if (
      input.endDate === undefined &&
      input.addInvitees.length === 0 &&
      removeEmails.length === 0 &&
      resendEmails.length === 0
    ) {
      throw new HttpsError('invalid-argument', 'Nothing to update');
    }

    const db = getFirestore();
    const windowRef = db.collection(COLLECTIONS.observationWindows).doc(input.windowId);
    const windowSnap = await windowRef.get();
    if (!windowSnap.exists) throw new HttpsError('not-found', 'Window not found');
    const window = windowSnap.data() as ObservationWindow;

    const callerRole = request.auth.token['role'] as string | undefined;
    const isAdmin = isAdminRole(callerRole ?? null);
    if (!isAdmin && window.observerEmail !== userEmail) {
      throw new HttpsError('permission-denied', 'Only the observer or an admin can edit.');
    }
    if (window.status === OBSERVATION_WINDOW_STATUS.cancelled) {
      throw new HttpsError('failed-precondition', 'A cancelled window cannot be edited');
    }

    // Resolve added invitees from /staff (deduped by email+building, batched
    // with `getAll` — same approach as createObservationWindow).
    const dedupedAdds: { email: string; buildingId: string }[] = [];
    const seen = new Set<string>();
    for (const inv of input.addInvitees) {
      const inviteeEmail = inv.email.toLowerCase();
      const dedupeKey = `${inviteeEmail}::${inv.buildingId}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      dedupedAdds.push({ email: inviteeEmail, buildingId: inv.buildingId });
    }

    const staffRefs = dedupedAdds.map((inv) => db.collection(COLLECTIONS.staff).doc(inv.email));
    const staffSnaps = staffRefs.length > 0 ? await db.getAll(...staffRefs) : [];

    const addedInvitees: WindowInvitee[] = [];
    for (const [i, entry] of dedupedAdds.entries()) {
      const staffSnap = staffSnaps[i];
      if (!staffSnap?.exists) {
        throw new HttpsError('not-found', `Staff not found: ${entry.email}`);
      }
      const staff = staffSnap.data() as Staff;

      addedInvitees.push({
        email: entry.email,
        name: staff.name,
        role: staff.role,
        year: staff.year,
        buildings: staff.buildings,
        buildingId: entry.buildingId,
        inviteToken: randomBytes(24).toString('base64url'),
        inviteSentAt: null,
        bookedSlotId: null,
      });
    }

    // Every building an added invitee books against must have a schedule —
    // the same precondition createObservationWindow enforces.
    const addedBuildingIds = [...new Set(addedInvitees.map((inv) => inv.buildingId))];
    const addedScheduleRefs = addedBuildingIds.map((id) =>
      db.collection(COLLECTIONS.buildingSchedules).doc(id),
    );
    const addedScheduleSnaps =
      addedScheduleRefs.length > 0 ? await db.getAll(...addedScheduleRefs) : [];
    const missingSchedules: string[] = [];
    for (const [i, buildingId] of addedBuildingIds.entries()) {
      if (!addedScheduleSnaps[i]?.exists) missingSchedules.push(buildingId);
    }
    if (missingSchedules.length > 0) {
      throw new HttpsError(
        'failed-precondition',
        `Missing building schedule(s): ${missingSchedules.join(', ')}`,
      );
    }

    // Apply the edit atomically: invitee bookings and day-preference counts
    // race with the booking callables, so read-modify-write in a transaction.
    let updatedWindow: ObservationWindow | null = null;
    let removedCount = 0;

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(windowRef);
      if (!snap.exists) throw new HttpsError('not-found', 'Window not found');
      const w = snap.data() as ObservationWindow;
      if (w.status === OBSERVATION_WINDOW_STATUS.cancelled) {
        throw new HttpsError('failed-precondition', 'A cancelled window cannot be edited');
      }

      let endDate = w.endDate;
      if (input.endDate !== undefined) {
        if (input.endDate < w.endDate) {
          throw new HttpsError('invalid-argument', 'The end date can only be extended');
        }
        endDate = input.endDate;
      }
      if (w.status === OBSERVATION_WINDOW_STATUS.expired && endDate < chicagoToday(new Date())) {
        throw new HttpsError(
          'failed-precondition',
          'This window has expired — extend its end date to today or later to re-open it',
        );
      }

      // Read removed invitees' day preferences (all reads before writes).
      const prefRefs =
        w.bookingMode === 'day-preference' && removeEmails.length > 0
          ? removeEmails.map((e) => windowRef.collection(WINDOW_SUBCOLLECTIONS.preferences).doc(e))
          : [];
      const prefSnaps = await Promise.all(prefRefs.map((ref) => tx.get(ref)));

      let invitees = [...w.invitees];
      removedCount = 0;
      for (const emailToRemove of removeEmails) {
        const matches = invitees.filter((inv) => inv.email === emailToRemove);
        if (matches.length === 0) {
          throw new HttpsError('not-found', `Invitee not found: ${emailToRemove}`);
        }
        if (matches.some((inv) => inv.bookedSlotId != null)) {
          throw new HttpsError(
            'failed-precondition',
            `Cannot remove ${emailToRemove} — they already have a booking. Cancel it first.`,
          );
        }
        invitees = invitees.filter((inv) => inv.email !== emailToRemove);
        removedCount += matches.length;
      }

      for (const invitee of addedInvitees) {
        if (invitees.some((existing) => existing.email === invitee.email)) {
          throw new HttpsError('failed-precondition', `Already invited: ${invitee.email}`);
        }
        invitees.push(invitee);
      }
      if (invitees.length === 0) {
        throw new HttpsError('failed-precondition', 'A window must keep at least one invitee');
      }

      // Validate resend targets against the post-edit invitee list so a bad
      // resend fails the whole call before anything is written.
      for (const emailToResend of resendEmails) {
        const invitee = invitees.find((inv) => inv.email === emailToResend);
        if (!invitee) {
          throw new HttpsError('not-found', `Invitee not found: ${emailToResend}`);
        }
        if (invitee.bookedSlotId != null) {
          throw new HttpsError(
            'failed-precondition',
            `${emailToResend} already booked — no invite to resend`,
          );
        }
      }

      // Free removed invitees' day-preference counts and delete their docs.
      let dayCounts = w.dayCounts;
      for (const prefSnap of prefSnaps) {
        if (!prefSnap.exists) continue;
        const pref = prefSnap.data() as ObservationPreference;
        const current = dayCounts[pref.preferredDateYMD] ?? 0;
        dayCounts = {
          ...dayCounts,
          [pref.preferredDateYMD]: Math.max(0, current - 1),
        };
        tx.delete(prefSnap.ref);
      }

      const invitedEmails = [...new Set(invitees.map((inv) => inv.email))];
      const anyBooked = invitees.some((inv) => inv.bookedSlotId != null);
      const status = anyBooked
        ? (nextWindowStatus(invitees) as ObservationWindow['status'])
        : OBSERVATION_WINDOW_STATUS.open;

      const docChanged =
        input.endDate !== undefined || removeEmails.length > 0 || addedInvitees.length > 0;
      if (docChanged) {
        tx.update(windowRef, {
          invitees,
          invitedEmails,
          endDate,
          dayCounts,
          status,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }

      updatedWindow = { ...w, invitees, invitedEmails, endDate, dayCounts, status };
    });

    const updated = updatedWindow as ObservationWindow | null;
    if (!updated) throw new HttpsError('internal', 'Update transaction did not complete');

    // Top up missing slots (new dates from an extension, new buildings from
    // added invitees). Slot ids are deterministic, so regenerate the full set
    // and write only ids that don't exist yet — booked/blocked slots are
    // never overwritten.
    let newSlotCount = 0;
    if (input.endDate !== undefined || addedInvitees.length > 0) {
      const buildingIds = [...new Set(updated.invitees.map((inv) => inv.buildingId))];
      const scheduleRefs = buildingIds.map((id) =>
        db.collection(COLLECTIONS.buildingSchedules).doc(id),
      );
      const scheduleSnaps = scheduleRefs.length > 0 ? await db.getAll(...scheduleRefs) : [];
      const schedulesByBuilding = new Map<string, BuildingSchedule>();
      for (const [i, buildingId] of buildingIds.entries()) {
        const schedSnap = scheduleSnaps[i];
        if (schedSnap?.exists) {
          schedulesByBuilding.set(buildingId, schedSnap.data() as BuildingSchedule);
        }
      }

      const slotInputs = generateSlotsForWindow(updated, schedulesByBuilding);
      const slotsCol = windowRef.collection(WINDOW_SUBCOLLECTIONS.slots);
      const existingIdsSnap = await slotsCol.select().get();
      const existingIds = new Set(existingIdsSnap.docs.map((d) => d.id));
      const now = FieldValue.serverTimestamp();
      const newSlots = slotInputs.filter((slot) => !existingIds.has(slot.slotId));
      newSlotCount = newSlots.length;

      for (let i = 0; i < newSlots.length; i += MAX_BATCH_WRITES) {
        const batch = db.batch();
        for (const slot of newSlots.slice(i, i + MAX_BATCH_WRITES)) {
          batch.set(slotsCol.doc(slot.slotId), { ...slot, generatedAt: now });
        }
        await batch.commit();
      }

      // Newly generated slots may overlap existing bookings — apply the
      // pe-conflict blocking pass so they can't be double-booked.
      if (newSlotCount > 0) {
        await recomputeBlockedSlots(db, input.windowId).catch((err: unknown) =>
          logger.error('updateObservationWindow: recomputeBlockedSlots failed', err),
        );
      }
    }

    await db.collection(COLLECTIONS.auditLog).add({
      timestamp: FieldValue.serverTimestamp(),
      userEmail,
      action: 'observationWindow.update',
      target: `${COLLECTIONS.observationWindows}/${input.windowId}`,
      details: {
        ...(input.endDate !== undefined ? { endDate: input.endDate } : {}),
        addedEmails: addedInvitees.map((inv) => inv.email),
        removedEmails: removeEmails,
        resendEmails,
        newSlotCount,
      },
    });

    // Best-effort invite emails: new invitees (when invite emails are
    // enabled, matching creation) plus explicit resends (always — the PE
    // asked for them by hand). One failure must not fail the whole call.
    const scheduling = await loadSchedulingSettings(db);
    const toEmail: { invitee: WindowInvitee; kind: 'invite' | 'resend' }[] = [];
    if (scheduling.inviteEmailEnabled) {
      for (const invitee of addedInvitees) toEmail.push({ invitee, kind: 'invite' });
    }
    for (const emailToResend of resendEmails) {
      const invitee = updated.invitees.find((inv) => inv.email === emailToResend);
      if (invitee) toEmail.push({ invitee, kind: 'resend' });
    }

    const sentEmails = new Set<string>();
    if (toEmail.length > 0) {
      const emailBuildingIds = [...new Set(toEmail.map(({ invitee }) => invitee.buildingId))];
      const buildingNames = new Map<string, string>();
      await Promise.all(
        emailBuildingIds.map(async (buildingId) => {
          try {
            const bSnap = await db.collection(COLLECTIONS.buildings).doc(buildingId).get();
            buildingNames.set(
              buildingId,
              bSnap.exists ? (bSnap.data() as Building).displayName : buildingId,
            );
          } catch {
            buildingNames.set(buildingId, buildingId);
          }
        }),
      );

      // Send concurrently — one invitee's failure must not block the others
      // (same pattern as createObservationWindow).
      const sends = toEmail.map(async ({ invitee }) => {
        try {
          const bookingLink = `${APP_URL}/book/${input.windowId}?token=${invitee.inviteToken}`;
          await sendTemplatedEmail({
            db,
            triggerType: 'scheduling.windowInvite',
            to: invitee.email,
            vars: {
              observerName: updated.observerName,
              observerEmail: updated.observerEmail,
              observedName: invitee.name,
              observedEmail: invitee.email,
              staffName: invitee.name,
              staffEmail: invitee.email,
              staffRole: invitee.role,
              bookingLink,
              buildingName: buildingNames.get(invitee.buildingId) ?? invitee.buildingId,
              windowStartLocal: formatYMD(updated.startDate),
              windowEndLocal: formatYMD(updated.endDate),
            },
            // Unique doc id per send so a resend isn't swallowed by the
            // Trigger Email extension's delivery state on the original doc
            // (same technique as cancelBooking).
            mailDocId: `scheduling.windowInvite-${input.windowId}-${invitee.email}-${Date.now().toString()}`,
            auditDetails: {
              windowId: input.windowId,
              inviteeEmail: invitee.email,
              triggerType: 'scheduling.windowInvite',
            },
          });
          sentEmails.add(invitee.email);
        } catch (err) {
          logger.error('updateObservationWindow: invite send failed', {
            email: invitee.email,
            err,
          });
        }
      });
      await Promise.allSettled(sends);

      // Stamp inviteSentAt for invitees we successfully emailed — via a
      // transaction so a concurrent booking's invitee update isn't clobbered.
      if (sentEmails.size > 0) {
        await db
          .runTransaction(async (tx) => {
            const snap = await tx.get(windowRef);
            if (!snap.exists) return;
            const w = snap.data() as ObservationWindow;
            const stamped = w.invitees.map((inv) =>
              sentEmails.has(inv.email) ? { ...inv, inviteSentAt: new Date() } : inv,
            );
            tx.update(windowRef, { invitees: stamped, updatedAt: FieldValue.serverTimestamp() });
          })
          .catch((err: unknown) =>
            logger.error('updateObservationWindow: inviteSentAt update failed', err),
          );
      }
    }

    return {
      ok: true as const,
      endDate: updated.endDate,
      addedCount: addedInvitees.length,
      removedCount,
      resentCount: sentEmails.size,
      newSlotCount,
    };
  },
);
