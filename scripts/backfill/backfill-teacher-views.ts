/**
 * One-time backfill: `/observations/{id}` → `/teacherViews/{id}`
 *
 * Context. Draft privacy is moving server-side: the observed teacher will
 * read a teacher-safe projection of each Draft (`teacherViewOf` in
 * packages/shared/src/schema/teacherView.ts) instead of the observation
 * itself. The `onObservationTeacherView` trigger keeps the view current on
 * every observation write, but observations that aren't written after the
 * trigger deploys would have no view. This script writes one for every
 * observation so the teacher pages can switch over (plan item F-2).
 *
 * Every view is rewritten from its observation with a full `set()`, the same
 * projection the trigger writes, so the script is idempotent and safe to
 * re-run.
 *
 * Targets (same conventions + credentials as scripts/import, scripts/export):
 *   --target=emulator     reads/writes the Firestore emulator on 127.0.0.1:8080
 *   --target=prod         reads/writes live Firestore (peer-evaluator-rubric);
 *                         requires --confirm
 *   --dry-run             reads the target and prints counts, writes nothing
 *
 * Auth (prod target):
 *   - gcloud auth application-default login   (recommended for one-shot
 *     interactive runs by Paul)
 *   - OR set GOOGLE_APPLICATION_CREDENTIALS to a JSON key path
 *
 * Usage:
 *   pnpm backfill:teacher-views:dry-run
 *   pnpm backfill:teacher-views:emulator
 *   pnpm backfill:teacher-views:prod -- --confirm
 */

import { config as loadDotenv } from 'dotenv';
import { FieldPath, FieldValue, type Firestore } from 'firebase-admin/firestore';
import { COLLECTIONS, teacherViewOf } from '@ops/shared';
import { initFirestore, type ImportTarget } from '../import/firebase.js';

loadDotenv();

/** Firestore caps a write batch at 500 operations; stay comfortably under.
 *  Also the read page size, so each page is one batch. */
const BATCH_SIZE = 400;

interface CliArgs {
  target: ImportTarget;
  dryRun: boolean;
  confirm: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const target = argv.find((a) => a.startsWith('--target='))?.split('=')[1];
  if (target !== 'emulator' && target !== 'prod') {
    throw new Error('Usage: --target=emulator|prod [--dry-run] [--confirm]');
  }
  return {
    target,
    dryRun: argv.includes('--dry-run'),
    confirm: argv.includes('--confirm'),
  };
}

interface Counts {
  observations: number;
  byStatus: Map<string, number>;
  written: number;
}

/** Pages through every observation by document id and writes (or, in a dry
 *  run, only counts) its teacher view. */
async function backfill(db: Firestore, dryRun: boolean): Promise<Counts> {
  const counts: Counts = { observations: 0, byStatus: new Map(), written: 0 };
  const observations = db.collection(COLLECTIONS.observations);
  const views = db.collection(COLLECTIONS.teacherViews);
  let lastId: string | null = null;

  for (;;) {
    let page = observations.orderBy(FieldPath.documentId()).limit(BATCH_SIZE);
    if (lastId !== null) page = page.startAfter(lastId);
    const snap = await page.get();
    if (snap.empty) break;

    const batch = db.batch();
    for (const d of snap.docs) {
      const status = String(d.get('status') ?? '(none)');
      counts.byStatus.set(status, (counts.byStatus.get(status) ?? 0) + 1);
      batch.set(views.doc(d.id), {
        ...teacherViewOf(d.data(), d.id),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    counts.observations += snap.size;
    if (!dryRun) {
      await batch.commit();
      counts.written += snap.size;
      console.log(`[backfill] committed ${String(counts.written)} view(s)`);
    }
    lastId = snap.docs[snap.docs.length - 1]?.id ?? null;
    if (snap.size < BATCH_SIZE) break;
  }
  return counts;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.target === 'prod' && !args.dryRun && !args.confirm) {
    throw new Error('Refusing to write to prod without --confirm. Re-run with --dry-run first.');
  }

  console.log(`[backfill] target=${args.target}${args.dryRun ? ' (dry run — no writes)' : ''}`);
  const db = initFirestore(args.target);

  const counts = await backfill(db, args.dryRun);

  console.log('\n=== Teacher views ===');
  console.log(`Observations read: ${String(counts.observations)}`);
  for (const [status, n] of [...counts.byStatus].sort()) {
    console.log(`  ${status}: ${String(n)}`);
  }
  if (args.dryRun) {
    console.log(`\n[backfill] dry run — would write ${String(counts.observations)} view(s).`);
    return;
  }
  console.log(`\n[backfill] done — ${String(counts.written)} view(s) written.`);
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
