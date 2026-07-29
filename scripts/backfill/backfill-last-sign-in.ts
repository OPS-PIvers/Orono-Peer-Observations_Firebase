/**
 * One-time backfill: /auditLog `sign_in` entries → `staff/{email}.lastSignInAt`
 *
 * Context. PLAT-10 denormalizes a `lastSignInAt` stamp onto each staff doc
 * (written by the `syncMyClaims` callable on every sign-in) so the admin
 * "never signed in" rollout card can be a plain live Firestore query for
 * `isActive == true && lastSignInAt == null`. Without this backfill, every
 * staff member who was already active before the field shipped would be
 * misreported — either as a false "never signed in" (they have signed in,
 * we just never stamped it) or, worse, invisible to the card entirely.
 *
 * That second failure mode is the subtle one and the reason this script
 * writes explicit nulls: Firestore's `where('lastSignInAt', '==', null)`
 * matches documents whose field is *present and null*. A document that
 * simply omits the field does not match any equality filter on it. So a
 * pre-existing staff doc with no `lastSignInAt` key would silently never
 * appear on the card. This script therefore touches every staff doc:
 *
 *   - has a real (non-null) stamp already   → skip; live data always wins
 *   - has sign-in audit history             → stamp the most recent one
 *   - no audit history, field absent        → write an explicit null
 *   - no audit history, already null        → skip; nothing would change
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
 *   pnpm backfill:last-sign-in:dry-run
 *   pnpm backfill:last-sign-in:emulator
 *   pnpm backfill:last-sign-in:prod -- --confirm
 *
 * Safe to re-run: every branch above is idempotent.
 */

import { config as loadDotenv } from 'dotenv';
import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { AUDIT_ACTIONS, COLLECTIONS } from '@ops/shared';
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

/** One staff doc, reduced to just what the plan depends on. */
export interface StaffLastSignInState {
  email: string;
  /** `undefined` = field absent, `null` = present-and-null, number = stamped. */
  lastSignInAtMs: number | null | undefined;
}

/** One `sign_in` /auditLog entry, reduced to just what the plan depends on. */
export interface SignInAuditEntry {
  userEmail: string | null;
  timestampMs: number;
}

/** A single staff doc that needs a write. */
export interface BackfillWrite {
  email: string;
  /** Value to write — a real sign-in time, or an explicit null. */
  lastSignInAtMs: number | null;
  reason: 'stamped-from-audit' | 'initialized-null';
}

export interface BackfillPlan {
  writes: BackfillWrite[];
  /** Staff docs left untouched, with why (for the console summary). */
  skippedAlreadyStamped: string[];
  skippedAlreadyNull: string[];
  /** `sign_in` entries whose userEmail has no /staff doc — reported, not written. */
  orphanSignInEmails: string[];
}

/**
 * Pure planner — decides what to write, given the current staff docs and the
 * `sign_in` audit history. Kept free of Firestore so the decision table above
 * is readable (and reviewable) in one place.
 */
export function planLastSignInBackfill(
  staff: readonly StaffLastSignInState[],
  signIns: readonly SignInAuditEntry[],
): BackfillPlan {
  const latestByEmail = new Map<string, number>();
  for (const entry of signIns) {
    const email = entry.userEmail?.trim().toLowerCase();
    if (!email) continue;
    const current = latestByEmail.get(email);
    if (current === undefined || entry.timestampMs > current) {
      latestByEmail.set(email, entry.timestampMs);
    }
  }

  const plan: BackfillPlan = {
    writes: [],
    skippedAlreadyStamped: [],
    skippedAlreadyNull: [],
    orphanSignInEmails: [],
  };
  const staffEmails = new Set<string>();

  for (const row of staff) {
    staffEmails.add(row.email);

    // A live stamp from syncMyClaims is always fresher than audit history.
    if (typeof row.lastSignInAtMs === 'number') {
      plan.skippedAlreadyStamped.push(row.email);
      continue;
    }

    const fromAudit = latestByEmail.get(row.email);
    if (fromAudit !== undefined) {
      plan.writes.push({
        email: row.email,
        lastSignInAtMs: fromAudit,
        reason: 'stamped-from-audit',
      });
      continue;
    }

    // No history. Only worth a write if the field is missing entirely —
    // that's the case the `== null` query cannot see.
    if (row.lastSignInAtMs === undefined) {
      plan.writes.push({ email: row.email, lastSignInAtMs: null, reason: 'initialized-null' });
    } else {
      plan.skippedAlreadyNull.push(row.email);
    }
  }

  plan.orphanSignInEmails = [...latestByEmail.keys()].filter((e) => !staffEmails.has(e)).sort();
  return plan;
}

/** Firestore stores these as Timestamps; tolerate legacy Date values too. */
function toMillis(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (value instanceof Timestamp) return value.toMillis();
  if (value instanceof Date) return value.getTime();
  return null;
}

async function readStaff(db: Firestore): Promise<StaffLastSignInState[]> {
  const snap = await db.collection(COLLECTIONS.staff).get();
  return snap.docs.map((d) => ({
    email: d.id,
    lastSignInAtMs: toMillis(d.get('lastSignInAt')),
  }));
}

async function readSignIns(db: Firestore): Promise<SignInAuditEntry[]> {
  const snap = await db
    .collection(COLLECTIONS.auditLog)
    .where('action', '==', AUDIT_ACTIONS.signIn)
    .get();
  const entries: SignInAuditEntry[] = [];
  for (const d of snap.docs) {
    const ms = toMillis(d.get('timestamp'));
    if (typeof ms !== 'number') continue;
    const userEmail: unknown = d.get('userEmail');
    entries.push({
      userEmail: typeof userEmail === 'string' ? userEmail : null,
      timestampMs: ms,
    });
  }
  return entries;
}

async function applyPlan(db: Firestore, writes: readonly BackfillWrite[]): Promise<void> {
  for (let i = 0; i < writes.length; i += BATCH_SIZE) {
    const chunk = writes.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    for (const w of chunk) {
      batch.update(db.collection(COLLECTIONS.staff).doc(w.email), {
        lastSignInAt: w.lastSignInAtMs === null ? null : Timestamp.fromMillis(w.lastSignInAtMs),
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

  const [staff, signIns] = await Promise.all([readStaff(db), readSignIns(db)]);
  console.log(
    `[backfill] read ${String(staff.length)} staff doc(s), ${String(signIns.length)} sign_in audit entr(ies)`,
  );
  if (signIns.length === 0) {
    console.log(
      '[backfill] NOTE: no sign_in audit entries found. Nothing can be recovered from history — ' +
        'every staff doc will simply be initialized to null so the admin card can see it.',
    );
  }

  const plan = planLastSignInBackfill(staff, signIns);
  const stamped = plan.writes.filter((w) => w.reason === 'stamped-from-audit');
  const initialized = plan.writes.filter((w) => w.reason === 'initialized-null');

  console.log('\n=== Plan ===');
  console.log(`Stamp from audit history: ${String(stamped.length)}`);
  for (const w of stamped) {
    console.log(`  ${w.email} → ${new Date(w.lastSignInAtMs ?? 0).toISOString()}`);
  }
  console.log(`Initialize to null:       ${String(initialized.length)}`);
  console.log(`Skipped (already stamped):${String(plan.skippedAlreadyStamped.length)}`);
  console.log(`Skipped (already null):   ${String(plan.skippedAlreadyNull.length)}`);
  if (plan.orphanSignInEmails.length > 0) {
    console.log(
      `\nWarning: ${String(plan.orphanSignInEmails.length)} sign_in email(s) have no /staff doc:`,
    );
    for (const e of plan.orphanSignInEmails) console.log(`  - ${e}`);
  }

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
