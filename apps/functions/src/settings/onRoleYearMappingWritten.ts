import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { COLLECTIONS, type Role } from '@ops/shared';
import { sendTemplatedEmail } from '../lib/emailUtils.js';

if (getApps().length === 0) initializeApp();

/**
 * /mail doc id for a subdomain-assignment notification.
 *
 * Includes the send timestamp so a later re-assignment for the same role/year
 * mapping creates a *new* /mail doc and actually re-sends. The Trigger Email
 * extension only sends on /mail doc *creation*, so a static
 * `subdomains-<mappingId>-<email>` id would silently no-op on every update
 * after the first (same rationale as staffInviteMailDocId).
 */
export function roleYearMappingMailDocId(mappingId: string, email: string, nowMs: number): string {
  return `subdomains-${mappingId}-${email.replace('@', '-at-')}-${String(nowMs)}`;
}

/**
 * Dependencies for processRoleYearMappingUpdate — injected so unit tests can
 * stub Firestore and the email sender without the emulator.
 */
export interface ProcessRoleYearMappingDeps {
  db: Firestore;
  send: typeof sendTemplatedEmail;
  now: () => number;
}

/**
 * Sends the roleYearMapping.updated template to each active staff member in
 * the mapping's role+year combination.
 *
 * `staff.role` stores the role *slug* (see packages/shared/src/roles.ts), so
 * staff are matched on the mapping's `roleId`. A displayName fallback covers
 * any legacy docs the slug migration missed.
 */
export async function processRoleYearMappingUpdate(
  mappingId: string,
  afterData: Record<string, unknown>,
  deps: ProcessRoleYearMappingDeps,
): Promise<void> {
  const { db, send, now } = deps;
  const roleId = afterData['roleId'] as string;
  const year = afterData['year'] as number;
  const assignedIds: string[] = (afterData['assignedComponentIds'] as string[] | undefined) ?? [];

  // Load the role doc to get the display name (used in the email body)
  const roleSnap = await db.collection(COLLECTIONS.roles).doc(roleId).get();
  if (!roleSnap.exists) return;
  const roleData = roleSnap.data() as Role;
  const roleDisplayName = roleData.displayName;

  // Find all active staff with this role and year. staff.role stores the
  // slug, so query on roleId; fall back to displayName for un-migrated docs.
  let staffSnap = await db
    .collection(COLLECTIONS.staff)
    .where('role', '==', roleId)
    .where('year', '==', year)
    .where('isActive', '==', true)
    .get();
  if (staffSnap.empty) {
    staffSnap = await db
      .collection(COLLECTIONS.staff)
      .where('role', '==', roleDisplayName)
      .where('year', '==', year)
      .where('isActive', '==', true)
      .get();
  }
  if (staffSnap.empty) return;

  const assignedCount = assignedIds.length;

  const sends = staffSnap.docs.map((staffDoc) => {
    const staff = staffDoc.data();
    const staffEmail = staffDoc.id;
    return send({
      db,
      triggerType: 'roleYearMapping.updated',
      to: staffEmail,
      vars: {
        staffName: (staff['name'] as string | undefined) ?? staffEmail.split('@')[0],
        staffEmail,
        staffRole: roleDisplayName,
        staffYear: String(year),
        observedName: (staff['name'] as string | undefined) ?? staffEmail.split('@')[0],
        observedEmail: staffEmail,
        assignedComponentCount: String(assignedCount),
        assignedDomainList:
          assignedCount > 0
            ? `${String(assignedCount)} component${assignedCount === 1 ? '' : 's'} assigned`
            : 'No components assigned',
      },
      mailDocId: roleYearMappingMailDocId(mappingId, staffEmail, now()),
      auditDetails: { mappingId, staffEmail, triggerType: 'roleYearMapping.updated' },
    }).catch((err: unknown) => {
      logger.error('onRoleYearMappingWritten: send failed', { staffEmail, err });
    });
  });

  await Promise.allSettled(sends);
  logger.info('onRoleYearMappingWritten: sent', { mappingId, count: staffSnap.size });
}

/**
 * Fires when an admin updates subdomain assignments for a role+year.
 * Sends the roleYearMapping.updated template to each active staff member
 * in that role/year combination.
 */
export const onRoleYearMappingWritten = onDocumentWritten(
  { document: 'roleYearMappings/{mappingId}', region: 'us-central1', memory: '256MiB' },
  async (event) => {
    // Only fire on updates (not initial seeding — check before exists)
    if (!event.data?.before.exists) return;
    const afterData = event.data.after.data();
    if (!afterData) return;

    await processRoleYearMappingUpdate(event.params.mappingId, afterData, {
      db: getFirestore(),
      send: sendTemplatedEmail,
      now: Date.now,
    });
  },
);
