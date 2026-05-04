import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  isAdminRole,
  type Rubric,
  type RubricComponent,
  type RubricDomain,
  type RubricLookFor,
  type Staff,
} from '@ops/shared';

if (getApps().length === 0) initializeApp();

interface MigrationResult {
  rubricsScanned: number;
  rubricsTouched: number;
  componentsConverted: number;
  lookForsCreated: number;
  componentsSkippedHasLookFors: number;
  sample: { rubricId: string; componentId: string; from: string; to: string[] }[];
}

/**
 * One-shot migration: split each component's `bestPractices` text into
 * individual `lookFors` checklist items. The original sheet import
 * stuffed multi-line "best practices" content into a single textarea —
 * admins want them surfaced as checkboxes during observations instead.
 *
 * For each component:
 *   - skip if `lookFors` already has entries (don't clobber admin edits)
 *   - skip if `bestPractices` is empty
 *   - else split on newlines, drop blanks, strip bullet prefixes
 *     ("•", "-", "*", "—", "·"), and create one lookFor per line with a
 *     stable id `lf-mig-{componentId}-{index}`
 *   - clear `bestPractices` so the popover doesn't duplicate the list
 *
 * Idempotent — once migrated, lookFors is non-empty and the component is
 * skipped on re-run. Existing observations' `selectedLookForIds` are
 * unaffected (the new ids didn't exist when those observations were
 * created, so nothing references them).
 */
export const migrateBestPracticesToLookFors = onCall(
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

    const rubricsSnap = await db.collection(COLLECTIONS.rubrics).get();

    const result: MigrationResult = {
      rubricsScanned: rubricsSnap.size,
      rubricsTouched: 0,
      componentsConverted: 0,
      lookForsCreated: 0,
      componentsSkippedHasLookFors: 0,
      sample: [],
    };

    for (const docSnap of rubricsSnap.docs) {
      const rubric = docSnap.data() as Rubric;
      const touchedRef = { value: false };

      const newDomains: RubricDomain[] = rubric.domains.map((d) => ({
        ...d,
        components: d.components.map((c) =>
          convertComponent(c, docSnap.id, result, () => {
            touchedRef.value = true;
          }),
        ),
      }));

      if (touchedRef.value) {
        await docSnap.ref.update({ domains: newDomains });
        result.rubricsTouched += 1;
      }
    }

    logger.info('migrateBestPracticesToLookFors: complete', result);
    return result;
  },
);

function convertComponent(
  c: RubricComponent,
  rubricId: string,
  result: MigrationResult,
  markTouched: () => void,
): RubricComponent {
  const bp = c.bestPractices.trim();
  if (!bp) return c;
  if (c.lookFors.length > 0) {
    result.componentsSkippedHasLookFors += 1;
    return c;
  }

  const lines = splitToLines(bp);
  if (lines.length === 0) return c;

  const lookFors: RubricLookFor[] = lines.map((text, idx) => ({
    id: `lf-mig-${c.id}-${String(idx + 1)}`,
    text,
  }));

  if (result.sample.length < 3) {
    result.sample.push({
      rubricId,
      componentId: c.id,
      from: bp,
      to: lookFors.map((lf) => lf.text),
    });
  }

  result.componentsConverted += 1;
  result.lookForsCreated += lookFors.length;
  markTouched();

  return { ...c, bestPractices: '', lookFors };
}

const BULLET_PREFIX = /^[\s]*[•\-*—·]+[\s]+/;

function splitToLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((s) => s.replace(BULLET_PREFIX, '').trim())
    .filter((s) => s.length > 0);
}
