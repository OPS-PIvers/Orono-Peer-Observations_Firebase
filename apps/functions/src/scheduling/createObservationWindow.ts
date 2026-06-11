import { randomBytes } from 'node:crypto';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import {
  APP_SETTINGS_DOC_ID,
  AUDIT_ACTIONS,
  COLLECTIONS,
  DEFAULT_SCHEDULING_SETTINGS,
  OBSERVATION_WINDOW_STATUS,
  WINDOW_SUBCOLLECTIONS,
  createObservationWindowInput,
  isAdminRole,
  isSpecialRole,
  type Building,
  type BuildingSchedule,
  type ObservationWindow,
  type SchedulingSettings,
  type SignupField,
  type Staff,
  type WindowInvitee,
} from '@ops/shared';
import { APP_URL, sendTemplatedEmail } from '../lib/emailUtils.js';
import { generateSlotsForWindow } from './engine/slotGeneration.js';
import { formatYMD } from './engine/schedulingEmail.js';
import { chicagoDateString, invalidSignupFieldIds } from './engine/bookingRules.js';
import { observerBusyForWindow, recomputeBlockedSlots } from './engine/blocking.js';

if (getApps().length === 0) initializeApp();

const MAX_BATCH_WRITES = 450;

/**
 * Key identifying a single invitee *entry* on a window. The same person can
 * legitimately be invited at two buildings (two entries, two invite tokens),
 * so email alone is not unique — every per-entry lookup must key on
 * email + buildingId.
 */
export function inviteeEntryKey(email: string, buildingId: string): string {
  return `${email}::${buildingId}`;
}

/**
 * /mail doc id for a window-invite email.
 *
 * Keyed per invitee entry (email + building), not per email: the Trigger
 * Email extension only sends on /mail doc *creation*, so an email-only id
 * would make the second entry's send overwrite the first entry's /mail doc
 * and silently never deliver the second building's booking link/token.
 */
export function windowInviteMailDocId(windowId: string, email: string, buildingId: string): string {
  return `scheduling.windowInvite-${windowId}-${email}-${buildingId}`;
}

/**
 * Stamp inviteSentAt on exactly the invitee entries whose invite email was
 * sent, identified by {@link inviteeEntryKey}. Entries that were not sent
 * (or already carried a stamp) are returned unchanged.
 */
export function stampInviteSentAt(
  invitees: WindowInvitee[],
  sentKeys: ReadonlySet<string>,
  sentAt: Date,
): WindowInvitee[] {
  return invitees.map((inv) =>
    sentKeys.has(inviteeEntryKey(inv.email, inv.buildingId))
      ? { ...inv, inviteSentAt: sentAt }
      : inv,
  );
}

/**
 * Create an observation window plus all its bookable slots.
 *
 * Requires special access (PE / Full Access / Admin). Validates the input
 * with the shared Zod contract, resolves each invitee from /staff, mints a
 * per-invitee invite token, verifies every distinct building has a schedule,
 * generates slots deterministically, and writes the window doc + slot docs in
 * chunked batches. When invite emails are enabled, a best-effort invite is
 * sent per invitee *entry* (email + building) — the same person invited at
 * two buildings receives two emails, each with its own booking link/token.
 */
export const createObservationWindow = onCall(
  { region: 'us-central1', memory: '512MiB', timeoutSeconds: 120 },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required');
    const userEmail = request.auth.token.email?.toLowerCase();
    if (!userEmail) throw new HttpsError('unauthenticated', 'Token has no email');

    const callerRole = request.auth.token['role'] as string | undefined;
    const hasSpecialAccess = isSpecialRole(callerRole ?? null) || isAdminRole(callerRole ?? null);
    if (!hasSpecialAccess) {
      throw new HttpsError('permission-denied', 'Only PEs and admins can create windows');
    }

    const parsed = createObservationWindowInput.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError('invalid-argument', parsed.error.issues[0]?.message ?? 'Invalid input');
    }
    const input = parsed.data;

    const db = getFirestore();

    // Load scheduling settings early for policy validation.
    const settingsSnap = await db
      .collection(COLLECTIONS.appSettings)
      .doc(APP_SETTINGS_DOC_ID)
      .get();
    const scheduling: SchedulingSettings = {
      ...DEFAULT_SCHEDULING_SETTINGS,
      ...((settingsSnap.data()?.['scheduling'] as Partial<SchedulingSettings> | undefined) ?? {}),
    };

    // Validate bookingMode is in the admin's allowed list.
    if (!scheduling.allowedBookingModes.includes(input.bookingMode)) {
      throw new HttpsError(
        'invalid-argument',
        `bookingMode "${input.bookingMode}" not in allowed modes: ${scheduling.allowedBookingModes.join(', ')}`,
      );
    }

    // Validate endDate is not before today (Chicago time).
    const today = chicagoDateString(new Date());
    if (input.endDate < today) {
      throw new HttpsError(
        'invalid-argument',
        `endDate "${input.endDate}" must be on or after today "${today}"`,
      );
    }

    if (input.endDate < input.startDate) {
      throw new HttpsError('invalid-argument', 'endDate must be on or after startDate');
    }
    if (input.latestMinute < input.earliestMinute) {
      throw new HttpsError('invalid-argument', 'latestMinute must be >= earliestMinute');
    }

    // Validate signupFieldIds reference active, applicable fields.
    if (input.signupFieldIds.length > 0) {
      const fieldsSnap = await db.collection(COLLECTIONS.signupFields).get();
      const fields = fieldsSnap.docs.map((doc) => doc.data() as SignupField);
      const invalid = invalidSignupFieldIds(input.signupFieldIds, fields, input.bookingMode);
      if (invalid.length > 0) {
        throw new HttpsError(
          'invalid-argument',
          `Invalid signupFieldIds: ${invalid.join(', ')}. Fields must exist, be active, and apply to "${input.bookingMode}" mode.`,
        );
      }
    }

    // Resolve observer name from /staff/{email}.
    const observerSnap = await db.collection(COLLECTIONS.staff).doc(userEmail).get();
    const observerName = observerSnap.exists ? (observerSnap.data() as Staff).name : '';

    // Resolve each invitee from /staff (deduped by email; last buildingId wins
    // for a repeated email is disallowed — we key per email+building below).
    const invitees: WindowInvitee[] = [];
    const invitedEmails: string[] = [];
    const seen = new Set<string>();
    for (const inv of input.invitees) {
      const inviteeEmail = inv.email.toLowerCase();
      const dedupeKey = inviteeEntryKey(inviteeEmail, inv.buildingId);
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      const staffSnap = await db.collection(COLLECTIONS.staff).doc(inviteeEmail).get();
      if (!staffSnap.exists) {
        throw new HttpsError('not-found', `Staff not found: ${inviteeEmail}`);
      }
      const staff = staffSnap.data() as Staff;

      invitees.push({
        email: inviteeEmail,
        name: staff.name,
        role: staff.role,
        year: staff.year,
        buildings: staff.buildings,
        buildingId: inv.buildingId,
        inviteToken: randomBytes(24).toString('base64url'),
        inviteSentAt: null,
        bookedSlotId: null,
      });
      if (!invitedEmails.includes(inviteeEmail)) invitedEmails.push(inviteeEmail);
    }

    // Verify every distinct building has a schedule.
    const buildingIds = [...new Set(invitees.map((inv) => inv.buildingId))];
    const schedulesByBuilding = new Map<string, BuildingSchedule>();
    const missingSchedules: string[] = [];
    for (const buildingId of buildingIds) {
      const schedSnap = await db.collection(COLLECTIONS.buildingSchedules).doc(buildingId).get();
      if (!schedSnap.exists) {
        missingSchedules.push(buildingId);
        continue;
      }
      schedulesByBuilding.set(buildingId, schedSnap.data() as BuildingSchedule);
    }
    if (missingSchedules.length > 0) {
      throw new HttpsError(
        'failed-precondition',
        `Missing building schedule(s): ${missingSchedules.join(', ')}`,
      );
    }

    // Allocate the window id up-front so slots can reference it.
    const windowRef = db.collection(COLLECTIONS.observationWindows).doc();
    const windowId = windowRef.id;
    const now = FieldValue.serverTimestamp();

    const windowDoc: Record<string, unknown> = {
      windowId,
      observerEmail: userEmail,
      observerName,
      bookingMode: input.bookingMode,
      invitedEmails,
      invitees,
      startDate: input.startDate,
      endDate: input.endDate,
      weekdaysIncluded: input.weekdaysIncluded,
      earliestMinute: input.earliestMinute,
      latestMinute: input.latestMinute,
      travelBufferMinutes: input.travelBufferMinutes,
      perDayCap: input.perDayCap,
      dayCounts: {},
      peBusyIntervals: [],
      signupFieldIds: input.signupFieldIds,
      defaultObservationType: input.defaultObservationType,
      defaultObservationName: input.defaultObservationName,
      calendarEventTitle: input.calendarEventTitle,
      calendarEventDescription: input.calendarEventDescription,
      gcalSendUpdates: input.gcalSendUpdates,
      status: OBSERVATION_WINDOW_STATUS.open,
      createdAt: now,
      updatedAt: now,
      cancelledAt: null,
      cancelledBy: null,
      cancellationReason: '',
    };

    // Generate slots against an in-memory window shape (the timestamp fields
    // aren't read by the generator).
    const windowForGen = {
      ...windowDoc,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as ObservationWindow;
    const slotInputs = generateSlotsForWindow(windowForGen, schedulesByBuilding);

    // Write window + slots in chunked batches (≤450 writes/batch).
    const slotsCol = windowRef.collection(WINDOW_SUBCOLLECTIONS.slots);
    const writes: { ref: FirebaseFirestore.DocumentReference; data: Record<string, unknown> }[] = [
      { ref: windowRef, data: windowDoc },
    ];
    for (const slot of slotInputs) {
      writes.push({
        ref: slotsCol.doc(slot.slotId),
        data: { ...slot, generatedAt: now },
      });
    }

    for (let i = 0; i < writes.length; i += MAX_BATCH_WRITES) {
      const batch = db.batch();
      for (const w of writes.slice(i, i + MAX_BATCH_WRITES)) {
        batch.set(w.ref, w.data);
      }
      await batch.commit();
    }

    // Optionally consult the evaluator's real Google Calendar availability and
    // block slots that overlap meetings / PTO / other events. Best-effort and
    // gated on the admin toggle + a freebusy-scoped connection — a missing
    // scope or any API failure leaves all slots available (returns null).
    if (scheduling.checkObserverCalendar) {
      try {
        const observerBusy = await observerBusyForWindow(windowForGen, scheduling);
        if (observerBusy !== null) {
          await recomputeBlockedSlots(db, windowId, observerBusy);
        }
      } catch (err) {
        logger.error('createObservationWindow: observer-calendar availability check failed', {
          windowId,
          err,
        });
      }
    }

    await db.collection(COLLECTIONS.auditLog).add({
      timestamp: now,
      userEmail,
      action: AUDIT_ACTIONS.windowCreated,
      target: `${COLLECTIONS.observationWindows}/${windowId}`,
      details: {
        bookingMode: input.bookingMode,
        startDate: input.startDate,
        endDate: input.endDate,
        inviteeCount: invitees.length,
        slotCount: slotInputs.length,
      },
    });

    // Best-effort invite emails. One failure must not fail the whole call.
    if (scheduling.inviteEmailEnabled) {
      const buildingNames = new Map<string, string>();
      for (const buildingId of buildingIds) {
        try {
          const bSnap = await db.collection(COLLECTIONS.buildings).doc(buildingId).get();
          buildingNames.set(
            buildingId,
            bSnap.exists ? (bSnap.data() as Building).displayName : buildingId,
          );
        } catch {
          buildingNames.set(buildingId, buildingId);
        }
      }

      const sentKeys = new Set<string>();
      for (const invitee of invitees) {
        try {
          const bookingLink = `${APP_URL}/book/${windowId}?token=${invitee.inviteToken}`;
          await sendTemplatedEmail({
            db,
            triggerType: 'scheduling.windowInvite',
            to: invitee.email,
            vars: {
              observerName,
              observerEmail: userEmail,
              observedName: invitee.name,
              observedEmail: invitee.email,
              staffName: invitee.name,
              staffEmail: invitee.email,
              staffRole: invitee.role,
              bookingLink,
              buildingName: buildingNames.get(invitee.buildingId) ?? invitee.buildingId,
              windowStartLocal: formatYMD(input.startDate),
              windowEndLocal: formatYMD(input.endDate),
            },
            mailDocId: windowInviteMailDocId(windowId, invitee.email, invitee.buildingId),
            auditDetails: {
              windowId,
              inviteeEmail: invitee.email,
              buildingId: invitee.buildingId,
              triggerType: 'scheduling.windowInvite',
            },
          });
          sentKeys.add(inviteeEntryKey(invitee.email, invitee.buildingId));
        } catch (err) {
          logger.error('createObservationWindow: invite send failed', {
            email: invitee.email,
            buildingId: invitee.buildingId,
            err,
          });
        }
      }

      // Stamp inviteSentAt for invitee entries we successfully emailed.
      if (sentKeys.size > 0) {
        const stamped = stampInviteSentAt(invitees, sentKeys, new Date());
        await windowRef
          .update({ invitees: stamped, updatedAt: FieldValue.serverTimestamp() })
          .catch((err: unknown) =>
            logger.error('createObservationWindow: inviteSentAt update failed', err),
          );
      }
    }

    return { windowId, slotCount: slotInputs.length, inviteeCount: invitees.length };
  },
);
