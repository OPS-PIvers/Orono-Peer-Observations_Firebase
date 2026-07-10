import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import {
  AUDIT_ACTIONS,
  COLLECTIONS,
  applyStaffRolloverInput,
  isAdminRole,
  type ApplyStaffRolloverResult,
  type Staff,
  type StaffRolloverEntry,
} from '@ops/shared';

if (getApps().length === 0) initializeApp();

/** Firestore getAll() has no hard cap but keep reads chunked and bounded. */
const READ_CHUNK = 300;
/** Stay under Firestore's 500-writes-per-batch limit. */
const WRITE_BATCH = 400;

/**
 * Annual staff cycle rollover (admin only).
 *
 * The web client computes each staff member's next cycle position with the
 * pure helpers in @ops/shared/cycle (1-3 continuing loop, 4-6 probationary →
 * tenure transition, summativeYear derivation), shows the admin a full
 * preview with per-row opt-out/override, and then sends the confirmed
 * per-person changes here. This function:
 *
 *   1. Verifies the caller is an admin — token claim first, then a live
 *      /staff lookup (like reopenObservation) so hasAdminAccess grants made
 *      after the token was minted aren't locked out.
 *   2. Validates the payload against the shared zod schema and rejects
 *      duplicate emails.
 *   3. Re-reads every targeted /staff doc and skips rows whose stored year
 *      no longer matches `fromYear` (concurrent edit since the preview
 *      loaded) or whose doc has been deleted — reported back, never
 *      silently written.
 *   4. Applies the surviving changes via chunked batched writes, stamping
 *      `updatedAt` like every other staff write path.
 *   5. Writes a single /auditLog entry recording who ran the rollover and
 *      the full per-person change list.
 */
export const applyStaffRollover = onCall(
  { region: 'us-central1', memory: '256MiB', timeoutSeconds: 300 },
  async (request): Promise<ApplyStaffRolloverResult> => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required');
    const userEmail = request.auth.token.email?.toLowerCase();
    if (!userEmail) throw new HttpsError('unauthenticated', 'Token has no email');

    const parsed = applyStaffRolloverInput.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError('invalid-argument', parsed.error.issues[0]?.message ?? 'Invalid input');
    }
    const { entries } = parsed.data;

    const seen = new Set<string>();
    for (const entry of entries) {
      if (seen.has(entry.email)) {
        throw new HttpsError('invalid-argument', `Duplicate staff email: ${entry.email}`);
      }
      seen.add(entry.email);
    }

    const db = getFirestore();

    // Admin-only. Check the live staff doc rather than only the token role
    // claim so hasAdminAccess grants (which rules honor via the isAdmin
    // claim) work here too.
    const callerRole = request.auth.token['role'] as string | undefined;
    let isAdmin = isAdminRole(callerRole ?? null);
    if (!isAdmin) {
      const callerSnap = await db.doc(`${COLLECTIONS.staff}/${userEmail}`).get();
      const caller = callerSnap.exists ? (callerSnap.data() as Staff) : null;
      isAdmin = !!caller && (isAdminRole(caller.role) || caller.hasAdminAccess);
    }
    if (!isAdmin) {
      throw new HttpsError('permission-denied', 'Only an admin can run the annual rollover.');
    }

    // Re-read every targeted doc so we only advance staff whose stored year
    // still matches what the admin previewed.
    const applicable: StaffRolloverEntry[] = [];
    const skippedStale: string[] = [];
    const missing: string[] = [];
    for (let i = 0; i < entries.length; i += READ_CHUNK) {
      const chunk = entries.slice(i, i + READ_CHUNK);
      const refs = chunk.map((e) => db.doc(`${COLLECTIONS.staff}/${e.email}`));
      const snaps = await db.getAll(...refs);
      snaps.forEach((snap, idx) => {
        const entry = chunk[idx];
        if (!entry) return;
        if (!snap.exists) {
          missing.push(entry.email);
          return;
        }
        const current = snap.data() as Staff;
        if (current.year !== entry.fromYear) {
          skippedStale.push(entry.email);
          return;
        }
        applicable.push(entry);
      });
    }

    for (let i = 0; i < applicable.length; i += WRITE_BATCH) {
      const chunk = applicable.slice(i, i + WRITE_BATCH);
      const batch = db.batch();
      for (const entry of chunk) {
        batch.update(db.doc(`${COLLECTIONS.staff}/${entry.email}`), {
          year: entry.toYear,
          summativeYear: entry.toSummativeYear,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
      await batch.commit();
    }

    const result: ApplyStaffRolloverResult = {
      applied: applicable.length,
      skippedStale,
      missing,
    };

    await db.collection(COLLECTIONS.auditLog).add({
      timestamp: FieldValue.serverTimestamp(),
      userEmail,
      action: AUDIT_ACTIONS.staffYearRollover,
      target: COLLECTIONS.staff,
      details: {
        requested: entries.length,
        applied: applicable.length,
        skippedStale,
        missing,
        changes: applicable.map((e) => ({
          email: e.email,
          fromYear: e.fromYear,
          toYear: e.toYear,
          toSummativeYear: e.toSummativeYear,
        })),
      },
    });

    logger.info('applyStaffRollover: complete', {
      by: userEmail,
      requested: entries.length,
      applied: applicable.length,
      skippedStale: skippedStale.length,
      missing: missing.length,
    });

    return result;
  },
);
