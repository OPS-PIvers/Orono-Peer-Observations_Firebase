import { HttpsError } from 'firebase-functions/v2/https';
import { COLLECTIONS, observeBlockReason, type ObserverScope, type Staff } from '@ops/shared';

/** The observer's role and buildings, read from their staff doc (the
 *  window's observer may not be the caller, e.g. a staff member booking). */
export async function loadObserverScope(
  db: FirebaseFirestore.Firestore,
  observerEmail: string,
): Promise<ObserverScope> {
  const snap = await db.collection(COLLECTIONS.staff).doc(observerEmail.toLowerCase()).get();
  const observer = snap.exists ? (snap.data() as Staff) : null;
  return { role: observer?.role ?? null, buildings: observer?.buildings ?? [] };
}

/**
 * Throws when the observer may not observe any of `staff` — building
 * Administrators only observe active Probationary/High Cycle staff in their
 * own buildings (observeBlockReason). Mirrors the observation create rule in
 * firestore.rules, which the Admin SDK writes here would otherwise bypass.
 */
export function assertCanObserveAll(scope: ObserverScope, staff: Staff[]): void {
  const blocked = blockedStaff(scope, staff);
  if (blocked.length > 0) {
    throw new HttpsError(
      'failed-precondition',
      `You can't schedule observations for: ${blocked.join('; ')}.`,
    );
  }
}

/** "Name (reason)" for each of `staff` the observer may not observe. */
export function blockedStaff(scope: ObserverScope, staff: Staff[]): string[] {
  return staff.flatMap((s) => {
    const reason = observeBlockReason(scope, {
      ...s,
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Firestore reads bypass Zod defaults; older docs may lack these fields
      isActive: s.isActive ?? true,
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- as above
      buildings: s.buildings ?? [],
    });
    return reason ? [`${s.name || s.email} (${reason})`] : [];
  });
}
