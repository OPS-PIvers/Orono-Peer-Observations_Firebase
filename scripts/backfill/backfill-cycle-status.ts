/**
 * One-time backfill: legacy year/summativeYear → `staff/{email}.cycleStatus`
 *
 * Context. Status and year used to be one encoded value: status was never
 * stored, only derived from `year` + `summativeYear` (see `cycleStatus` in
 * packages/shared/src/cycle.ts), so changing either control in the admin UI
 * moved the other. The peer evaluation team needs them independent, so
 * status is now its own stored field and every reader goes through
 * `staffCycleStatus` — stored value first, legacy derivation as the
 * fallback. firestore.rules mirrors the same fallback.
 *
 * The fallback keeps un-backfilled docs behaving exactly as before, so this
 * script is not required for correctness. It exists so that every doc holds
 * a real stored status — after it runs, the legacy derivation is dead weight
 * that only protects docs created by some future path that forgets the field.
 *
 *   - staff doc already has a valid stored cycleStatus → skip; admin edits win
 *   - staff doc has no (or an unrecognised) status     → stamp the legacy
 *                                                        derived value
 *
 * Only `cycleStatus` is written. `summativeYear` is left as stored: every
 * reader now derives summative from the status (`isSummative`), and the next
 * status edit through any admin path re-syncs the flag.
 *
 * Targets (same conventions + credentials as scripts/import, scripts/export):
 *   --target=emulator     reads/writes the Firestore emulator on 127.0.0.1:8080
 *   --target=prod         reads/writes live Firestore (peer-evaluator-rubric);
 *                         requires --confirm
 *   --dry-run             reads the target and prints the plan, writes nothing
 *
 * Auth (prod target):
 *   - gcloud auth application-default login   (recommended for one-shot
 *     interactive runs by Paul)
 *   - OR set GOOGLE_APPLICATION_CREDENTIALS to a JSON key path
 *
 * Usage:
 *   pnpm backfill:cycle-status:dry-run
 *   pnpm backfill:cycle-status:emulator
 *   pnpm backfill:cycle-status:prod -- --confirm
 *
 * Safe to re-run: a doc stamped by an earlier run is skipped.
 */

import { config as loadDotenv } from 'dotenv';
import type { Firestore } from 'firebase-admin/firestore';
import { COLLECTIONS, CYCLE_STATUSES, cycleStatus, type CycleStatus } from '@ops/shared';
import { initFirestore, type ImportTarget } from '../import/firebase.js';

loadDotenv();

/** Firestore caps a write batch at 500 operations; stay comfortably under. */
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

/** One staff doc, reduced to just what the plan depends on. Raw `unknown`s
 *  because Firestore reads bypass the Zod schema. */
export interface StaffCycleState {
  email: string;
  year: unknown;
  summativeYear: unknown;
  cycleStatus: unknown;
}

/** A single staff doc that needs a write. */
export interface BackfillWrite {
  email: string;
  cycleStatus: CycleStatus;
}

export interface BackfillPlan {
  writes: BackfillWrite[];
  /** Staff docs left untouched because they already store a status. */
  skippedAlreadyStored: string[];
}

function isCycleStatus(value: unknown): value is CycleStatus {
  return typeof value === 'string' && (CYCLE_STATUSES as readonly string[]).includes(value);
}

/**
 * Pure planner — decides what to write from the current staff docs. Mirrors
 * the fallback in `staffCycleStatus` exactly (a missing year reads as 1, as
 * firestore.rules does), so a stamped doc resolves to the same status it
 * resolved to before the stamp.
 */
export function planCycleStatusBackfill(staff: readonly StaffCycleState[]): BackfillPlan {
  const plan: BackfillPlan = { writes: [], skippedAlreadyStored: [] };
  for (const row of staff) {
    if (isCycleStatus(row.cycleStatus)) {
      plan.skippedAlreadyStored.push(row.email);
      continue;
    }
    const year = typeof row.year === 'number' ? row.year : 1;
    plan.writes.push({
      email: row.email,
      cycleStatus: cycleStatus(year, row.summativeYear === true),
    });
  }
  return plan;
}

async function readStaff(db: Firestore): Promise<StaffCycleState[]> {
  const snap = await db.collection(COLLECTIONS.staff).get();
  return snap.docs.map((d) => ({
    email: d.id,
    year: d.get('year') as unknown,
    summativeYear: d.get('summativeYear') as unknown,
    cycleStatus: d.get('cycleStatus') as unknown,
  }));
}

async function applyPlan(db: Firestore, writes: readonly BackfillWrite[]): Promise<void> {
  for (let i = 0; i < writes.length; i += BATCH_SIZE) {
    const chunk = writes.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    for (const w of chunk) {
      batch.update(db.collection(COLLECTIONS.staff).doc(w.email), {
        cycleStatus: w.cycleStatus,
      });
    }
    await batch.commit();
    console.log(
      `[backfill] committed ${String(Math.min(i + BATCH_SIZE, writes.length))}/${String(writes.length)}`,
    );
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.target === 'prod' && !args.dryRun && !args.confirm) {
    throw new Error('Refusing to write to prod without --confirm. Re-run with --dry-run first.');
  }

  console.log(`[backfill] target=${args.target}${args.dryRun ? ' (dry run — no writes)' : ''}`);
  const db = initFirestore(args.target);

  const staff = await readStaff(db);
  console.log(`[backfill] read ${String(staff.length)} staff doc(s)`);

  const plan = planCycleStatusBackfill(staff);

  console.log('\n=== Plan ===');
  console.log(`Stamp legacy-derived status: ${String(plan.writes.length)}`);
  for (const status of CYCLE_STATUSES) {
    const count = plan.writes.filter((w) => w.cycleStatus === status).length;
    console.log(`  ${status}: ${String(count)}`);
  }
  for (const w of plan.writes) console.log(`  ${w.email} → ${w.cycleStatus}`);
  console.log(`Skipped (already stored):    ${String(plan.skippedAlreadyStored.length)}`);

  if (args.dryRun) {
    console.log('\n[backfill] dry run — no writes performed.');
    return;
  }
  if (plan.writes.length === 0) {
    console.log('\n[backfill] nothing to write.');
    return;
  }

  await applyPlan(db, plan.writes);
  console.log(`\n[backfill] done — ${String(plan.writes.length)} staff doc(s) updated.`);
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
