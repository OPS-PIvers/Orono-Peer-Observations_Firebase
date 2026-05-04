import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { COLLECTIONS, type Role } from '@ops/shared';
import { sendTemplatedEmail } from '../lib/emailUtils.js';

if (getApps().length === 0) initializeApp();

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

    const db = getFirestore();
    const mappingId = event.params.mappingId;
    const roleId = afterData['roleId'] as string;
    const year = afterData['year'] as number;
    const assignedIds: string[] = (afterData['assignedComponentIds'] as string[] | undefined) ?? [];

    // Load the role doc to get display name
    const roleSnap = await db.collection(COLLECTIONS.roles).doc(roleId).get();
    if (!roleSnap.exists) return;
    const roleData = roleSnap.data() as Role;
    const roleDisplayName = roleData.displayName;

    // Find all active staff with this role and year
    const staffSnap = await db
      .collection(COLLECTIONS.staff)
      .where('role', '==', roleDisplayName)
      .where('year', '==', year)
      .where('isActive', '==', true)
      .get();

    if (staffSnap.empty) return;

    const assignedCount = assignedIds.length;

    const sends = staffSnap.docs.map((staffDoc) => {
      const staff = staffDoc.data();
      const staffEmail = staffDoc.id;
      return sendTemplatedEmail({
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
        mailDocId: `subdomains-${mappingId}-${staffEmail.split('@')[0]}`,
        auditDetails: { mappingId, staffEmail, triggerType: 'roleYearMapping.updated' },
      }).catch((err: unknown) => {
        logger.error('onRoleYearMappingWritten: send failed', { staffEmail, err });
      });
    });

    await Promise.allSettled(sends);
    logger.info('onRoleYearMappingWritten: sent', { mappingId, count: staffSnap.size });
  },
);
