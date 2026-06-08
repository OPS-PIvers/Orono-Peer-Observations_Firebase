import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { getApps, initializeApp } from 'firebase-admin/app';
import { type Firestore, getFirestore } from 'firebase-admin/firestore';
import { COLLECTIONS, isAdminRole, type Role, type Staff } from '@ops/shared';

if (getApps().length === 0) initializeApp();

interface MigrationResult {
  staffMigrated: number;
  staffAlreadySlug: number;
  staffUnmatched: { email: string; rawRole: string }[];
  observationsMigrated: number;
  observationsAlreadySlug: number;
  observationsUnmatched: { observationId: string; rawRole: string }[];
}

const BATCH_SIZE = 400;

/**
 * One-shot migration: convert `staff.role` and `observation.observedRole`
 * from the role's displayName (legacy free-text) to its `roleId` slug.
 *
 * Idempotent — values that already match a known roleId are left alone.
 * Values that don't match any known displayName OR roleId are also left
 * alone and reported in the result so the admin can clean them up via
 * the staff editor's "unmapped" UI.
 *
 * Admin-gated via a live /staff lookup (token claim could be stale during
 * the same migration window).
 */
export const migrateRolesToSlugs = onCall(
  { region: 'us-central1', memory: '512MiB', timeoutSeconds: 540 },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required');
    const userEmail = request.auth.token.email?.toLowerCase();
    if (!userEmail) throw new HttpsError('unauthenticated', 'Token has no email');

    const db = getFirestore();
    const callerSnap = await db.doc(`${COLLECTIONS.staff}/${userEmail}`).get();
    const caller = callerSnap.exists ? (callerSnap.data() as Staff) : null;
    const isAdmin = !!caller && (isAdminRole(caller.role) || caller.hasAdminAccess);
    if (!isAdmin) throw new HttpsError('permission-denied', 'Admin only');

    const rolesSnap = await db.collection(COLLECTIONS.roles).get();
    const knownSlugs = new Set<string>();
    const displayNameToSlug = new Map<string, string>();
    for (const d of rolesSnap.docs) {
      const r = d.data() as Role;
      knownSlugs.add(r.roleId);
      displayNameToSlug.set(r.displayName.trim().toLowerCase(), r.roleId);
    }

    const result: MigrationResult = {
      staffMigrated: 0,
      staffAlreadySlug: 0,
      staffUnmatched: [],
      observationsMigrated: 0,
      observationsAlreadySlug: 0,
      observationsUnmatched: [],
    };

    await migrateCollection({
      db,
      collectionName: COLLECTIONS.staff,
      field: 'role',
      knownSlugs,
      displayNameToSlug,
      onMigrated: () => {
        result.staffMigrated += 1;
      },
      onAlreadySlug: () => {
        result.staffAlreadySlug += 1;
      },
      onUnmatched: (docId, raw) => {
        result.staffUnmatched.push({ email: docId, rawRole: raw });
      },
    });

    await migrateCollection({
      db,
      collectionName: COLLECTIONS.observations,
      field: 'observedRole',
      knownSlugs,
      displayNameToSlug,
      onMigrated: () => {
        result.observationsMigrated += 1;
      },
      onAlreadySlug: () => {
        result.observationsAlreadySlug += 1;
      },
      onUnmatched: (docId, raw) => {
        result.observationsUnmatched.push({ observationId: docId, rawRole: raw });
      },
    });

    logger.info('migrateRolesToSlugs: complete', result);
    return result;
  },
);

async function migrateCollection(args: {
  db: Firestore;
  collectionName: string;
  field: string;
  knownSlugs: ReadonlySet<string>;
  displayNameToSlug: ReadonlyMap<string, string>;
  onMigrated: () => void;
  onAlreadySlug: () => void;
  onUnmatched: (docId: string, raw: string) => void;
}) {
  const { db, collectionName, field, knownSlugs, displayNameToSlug } = args;
  const snap = await db.collection(collectionName).get();

  let batch = db.batch();
  let opsInBatch = 0;

  for (const docSnap of snap.docs) {
    const raw = (docSnap.get(field) as unknown) ?? '';
    if (typeof raw !== 'string' || !raw) continue;

    if (knownSlugs.has(raw)) {
      args.onAlreadySlug();
      continue;
    }

    const slug = displayNameToSlug.get(raw.trim().toLowerCase());
    if (!slug) {
      args.onUnmatched(docSnap.id, raw);
      continue;
    }

    batch.update(docSnap.ref, { [field]: slug });
    args.onMigrated();
    opsInBatch += 1;

    if (opsInBatch >= BATCH_SIZE) {
      await batch.commit();
      batch = db.batch();
      opsInBatch = 0;
    }
  }

  if (opsInBatch > 0) {
    await batch.commit();
  }
}
