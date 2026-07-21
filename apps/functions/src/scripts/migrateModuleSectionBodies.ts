import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { COLLECTIONS, MODULE_CONTENT_SUBCOLLECTION, isAdminRole, type Staff } from '@ops/shared';

if (getApps().length === 0) initializeApp();

/**
 * Raw, un-Zod-validated shape of a section as stored in the module doc's
 * `sections` array. Modeled loosely (all fields optional) because this is a
 * one-shot migration over legacy data — `body` is the deprecated inline field
 * we're moving out, and older docs may omit `title`.
 */
interface RawSection {
  id: string;
  type: string;
  title?: string;
  body?: string;
}

interface MigrationResult {
  modulesScanned: number;
  /** Modules that had at least one inline body moved out. */
  modulesMigrated: number;
  /** Section content docs written to /modules/{id}/content. */
  bodiesMoved: number;
  /** Modules already clean (no inline bodies to move). */
  alreadyClean: number;
}

/**
 * One-shot migration: move inline `richtext` section bodies off the
 * domain-readable module doc and into the access-controlled
 * `/modules/{id}/content/{sectionId}` subcollection.
 *
 * Why: the module doc's `sections[].body` carried cohort-targeted rich text
 * (probationary-only / summative-only guidance) but the whole doc is readable
 * by every signed-in district user (chips + nav need name/color/icon). The
 * `/content` subcollection is gated by the same assignment rule as
 * `/modules/{id}/items`, so only assigned/auto-enabled staff (and admins) can
 * read section bodies. New writes already go to `/content`; this backfills the
 * docs written before the change and clears the leaked inline copy.
 *
 * For each module section with a non-empty inline `body`:
 *   1) write `/modules/{id}/content/{sectionId}` ({ sectionId, moduleId, body }),
 *   2) strip `body` from that section in the module doc's `sections` array.
 *
 * Idempotent — a module whose sections carry no inline body is left untouched;
 * re-running after a successful pass moves nothing. `updatedAt`/`updatedBy` are
 * stamped on the content docs but the module doc's own `updatedAt` is left as
 * is (this is metadata relocation, not a content edit).
 *
 * Admin-gated via a live /staff lookup (token claim could be stale), matching
 * the other migration callables.
 */
export const migrateModuleSectionBodies = onCall(
  { region: 'us-central1', memory: '512MiB', timeoutSeconds: 540 },
  async (request): Promise<MigrationResult> => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required');
    const userEmail = request.auth.token.email?.toLowerCase();
    if (!userEmail) throw new HttpsError('unauthenticated', 'Token has no email');

    const db = getFirestore();
    const callerSnap = await db.doc(`${COLLECTIONS.staff}/${userEmail}`).get();
    const caller = callerSnap.exists ? (callerSnap.data() as Staff) : null;
    const isAdmin = !!caller && (isAdminRole(caller.role) || caller.hasAdminAccess);
    if (!isAdmin) throw new HttpsError('permission-denied', 'Admin only');

    const result: MigrationResult = {
      modulesScanned: 0,
      modulesMigrated: 0,
      bodiesMoved: 0,
      alreadyClean: 0,
    };

    const modulesSnap = await db.collection(COLLECTIONS.modules).get();

    for (const moduleSnap of modulesSnap.docs) {
      result.modulesScanned += 1;
      const moduleId = moduleSnap.id;

      // Read sections defensively — these are RAW Firestore values (they
      // bypass Zod), so older/manual docs may omit fields or carry the
      // deprecated inline `body`. Model them loosely and validate each field.
      const rawSections = moduleSnap.get('sections') as unknown;
      const sections: RawSection[] = Array.isArray(rawSections)
        ? (rawSections as RawSection[])
        : [];

      const sectionsWithBody = sections.filter(
        (s): s is RawSection & { body: string } =>
          typeof s.body === 'string' && s.body.trim().length > 0,
      );

      if (sectionsWithBody.length === 0) {
        result.alreadyClean += 1;
        continue;
      }

      // A module's sections array is small (≤ a handful), so a single batch
      // per module comfortably stays under the 500-op limit.
      const batch = db.batch();

      for (const section of sectionsWithBody) {
        const contentRef = db
          .collection(COLLECTIONS.modules)
          .doc(moduleId)
          .collection(MODULE_CONTENT_SUBCOLLECTION)
          .doc(section.id);
        batch.set(
          contentRef,
          {
            sectionId: section.id,
            moduleId,
            body: section.body,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            updatedBy: userEmail,
          },
          { merge: true },
        );
        result.bodiesMoved += 1;
      }

      // Strip the inline body from every section so the leaked copy is gone.
      // Rewrite the whole array (Firestore can't delete a field on an array
      // element in place). Keep only the public layout fields; drop the
      // deprecated inline `body`. `title` falls back to '' so we never write an
      // `undefined` (Firestore would reject it) for an older doc that omits it.
      const strippedSections = sections.map((s) => ({
        id: s.id,
        type: s.type,
        title: s.title ?? '',
      }));
      batch.update(moduleSnap.ref, { sections: strippedSections });

      await batch.commit();
      result.modulesMigrated += 1;
    }

    logger.info('migrateModuleSectionBodies: complete', result);
    return result;
  },
);
