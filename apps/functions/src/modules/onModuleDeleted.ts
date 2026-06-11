import { onDocumentDeleted } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions';
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, type Firestore, getFirestore } from 'firebase-admin/firestore';
import { COLLECTIONS, MODULE_SUBCOLLECTIONS, STAFF_SUBCOLLECTIONS } from '@ops/shared';

if (getApps().length === 0) initializeApp();

/**
 * How many staff docs to process per Firestore batch. Firestore enforces a
 * 500-operation-per-batch ceiling; 400 leaves headroom for future additions.
 */
const STAFF_BATCH_SIZE = 400;

/**
 * Dependencies injected into processModuleDelete so unit tests can stub
 * Firestore without the emulator.
 */
export interface ProcessModuleDeleteDeps {
  db: Firestore;
}

/**
 * Core cleanup logic extracted for unit testing.
 *
 * Performs three operations when a module is deleted:
 *  1. Recursively deletes the /modules/{moduleId}/items subcollection.
 *  2. Batch-removes the moduleId from every staff doc's `modules` array.
 *  3. Deletes all /staff/{email}/moduleProgress docs whose `moduleId` field
 *     matches the deleted module (via collectionGroup query).
 *
 * Each step runs independently with error isolation: a failure in one step
 * is logged but does not prevent the remaining steps from running.
 */
export async function processModuleDelete(
  moduleId: string,
  deps: ProcessModuleDeleteDeps,
): Promise<{ itemsDeleted: boolean; staffUpdated: number; progressDeleted: number }> {
  const { db } = deps;
  let staffUpdated = 0;
  let progressDeleted = 0;
  let itemsDeleted = false;

  // Step 1: Recursively delete the items subcollection.
  try {
    const itemsRef = db
      .collection(COLLECTIONS.modules)
      .doc(moduleId)
      .collection(MODULE_SUBCOLLECTIONS.items);
    const itemCount = await db.recursiveDelete(itemsRef);
    // recursiveDelete returns the number of deleted docs; type it as number.
    itemsDeleted = true;
    logger.info('onModuleDeleted: items subcollection deleted', {
      moduleId,
      count: itemCount,
    });
  } catch (err) {
    logger.error('onModuleDeleted: items subcollection delete failed', { moduleId, err });
  }

  // Step 2: Remove the moduleId from every staff doc's `modules` array.
  // Query in pages of STAFF_BATCH_SIZE to stay within Firestore batch limits.
  try {
    let staffSnap = await db
      .collection(COLLECTIONS.staff)
      .where('modules', 'array-contains', moduleId)
      .limit(STAFF_BATCH_SIZE)
      .get();

    while (!staffSnap.empty) {
      const batch = db.batch();
      for (const staffDoc of staffSnap.docs) {
        batch.update(staffDoc.ref, {
          modules: FieldValue.arrayRemove(moduleId),
        });
      }
      await batch.commit();
      staffUpdated += staffSnap.size;

      if (staffSnap.size < STAFF_BATCH_SIZE) break;

      // Fetch the next page (after the last doc in this page).
      staffSnap = await db
        .collection(COLLECTIONS.staff)
        .where('modules', 'array-contains', moduleId)
        .limit(STAFF_BATCH_SIZE)
        .startAfter(staffSnap.docs[staffSnap.docs.length - 1])
        .get();
    }

    logger.info('onModuleDeleted: staff module assignments removed', {
      moduleId,
      staffUpdated,
    });
  } catch (err) {
    logger.error('onModuleDeleted: staff assignment cleanup failed', { moduleId, err });
  }

  // Step 3: Delete all moduleProgress docs for this module via a
  // collectionGroup query. These live at /staff/{email}/moduleProgress/{itemId}
  // and carry a `moduleId` field for exactly this kind of batch cleanup.
  try {
    const progressSnap = await db
      .collectionGroup(STAFF_SUBCOLLECTIONS.moduleProgress)
      .where('moduleId', '==', moduleId)
      .get();

    if (!progressSnap.empty) {
      // Chunk into batches of STAFF_BATCH_SIZE to respect the 500-op limit.
      const docs = progressSnap.docs;
      for (let i = 0; i < docs.length; i += STAFF_BATCH_SIZE) {
        const chunk = docs.slice(i, i + STAFF_BATCH_SIZE);
        const batch = db.batch();
        for (const d of chunk) {
          batch.delete(d.ref);
        }
        await batch.commit();
        progressDeleted += chunk.length;
      }
    }

    logger.info('onModuleDeleted: progress docs deleted', { moduleId, progressDeleted });
  } catch (err) {
    logger.error('onModuleDeleted: progress doc cleanup failed', { moduleId, err });
  }

  return { itemsDeleted, staffUpdated, progressDeleted };
}

/**
 * Fires when an admin deletes a /modules/{moduleId} document and fully
 * retires the module:
 *
 *  1. Deletes the /modules/{moduleId}/items subcollection (prevents orphaned
 *     material items from appearing as ghost dashboard tasks for assigned staff).
 *  2. Removes the moduleId from every staff doc's `modules` array (prevents
 *     ghost chips on the staff dashboard and stops the items rule from granting
 *     any read access via a stale array entry).
 *  3. Deletes /staff/{email}/moduleProgress/{itemId} docs whose `moduleId`
 *     matches the deleted module (prunes stale completion state).
 *
 * All three steps are best-effort: a failure in any one step is logged but
 * does not abort the others.
 */
export const onModuleDeleted = onDocumentDeleted(
  {
    document: 'modules/{moduleId}',
    region: 'us-central1',
    memory: '512MiB',
  },
  async (event) => {
    const moduleId = event.params.moduleId;
    logger.info('onModuleDeleted: starting cleanup', { moduleId });

    await processModuleDelete(moduleId, { db: getFirestore() });

    logger.info('onModuleDeleted: cleanup complete', { moduleId });
  },
);
