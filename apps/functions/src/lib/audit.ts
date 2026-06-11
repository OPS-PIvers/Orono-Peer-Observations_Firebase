import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { AUDIT_ACTIONS, COLLECTIONS } from '@ops/shared';

/**
 * Writes a single audit log entry to /auditLog.
 *
 * All functions that need to record privileged actions should go through
 * this helper (or through sendEmail in emailUtils, which calls it internally)
 * so the write pattern stays consistent.
 *
 * `userEmail` is null when the actor cannot be determined server-side (e.g.
 * a Firestore trigger fired by a direct client write).
 */
export async function writeAuditLog(
  db: Firestore,
  entry: {
    userEmail: string | null;
    action: (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];
    target: string;
    details?: Record<string, unknown>;
  },
): Promise<void> {
  await db.collection(COLLECTIONS.auditLog).add({
    timestamp: FieldValue.serverTimestamp(),
    userEmail: entry.userEmail,
    action: entry.action,
    target: entry.target,
    details: entry.details ?? {},
  });
}

/**
 * Diffs two values of the same permission field.
 *
 * Returns `{ from, to }` when the value actually changed, or `null` when
 * unchanged (including both being undefined).
 */
export function diffField<T>(
  before: T | undefined,
  after: T | undefined,
  defaultValue: T,
): { from: T; to: T } | null {
  const a = before ?? defaultValue;
  const b = after ?? defaultValue;
  return a !== b ? { from: a, to: b } : null;
}
