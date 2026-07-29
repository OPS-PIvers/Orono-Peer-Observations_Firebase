/**
 * One-time backfill: Firebase Auth user records → `staff/{email}.lastSignInAt`
 *
 * Context. PLAT-10 denormalizes a `lastSignInAt` stamp onto each staff doc
 * (written by the `syncMyClaims` callable on every sign-in) so the admin
 * "never signed in" rollout card can query `isActive == true` and filter
 * client-side for a null-or-missing `lastSignInAt`. Without this backfill,
 * every staff member who signed in before the field shipped would be
 * misreported as "never signed in" — they have signed in, we just never
 * stamped it.
 *
 * This originally tried to source history from `/auditLog` `sign_in`
 * entries, but nothing in the codebase ever wrote that action — it only
 * existed in its own schema definition and in a rules test. That audit
 * history is empty. Firebase Auth's own user records are not: every user
 * who has ever signed in already carries `metadata.lastSignInTime`, so this
 * backfill reads that directly via the Admin SDK's `listUsers`, paginated
 * 1000 at a time, and matches each Auth user to a `/staff/{email}` doc by
 * email (case-insensitively; staff doc IDs are the lowercased email).
 *
 *   - staff doc already has a real (non-null) stamp   → skip; live data wins
 *   - matching Auth user has signed in before          → stamp that time
 *   - matching Auth user has never signed in           → leave alone (null/absent)
 *   - no matching Auth user (account never created, or → leave alone
 *     email mismatch)
 *
 * Deliberately does NOT write explicit nulls for "never signed in" staff:
 * the admin card no longer relies on an equality filter over `lastSignInAt`
 * (see NeverSignedInCard.tsx), so there is nothing for this script to
 * initialize — a doc that simply omits the field is just as visible to the
 * card as one explicitly set to null.
 *
 * Targets (same conventions + credentials as scripts/import, scripts/export):
 *   --target=emulator     reads/writes the Firestore + Auth emulators on
 *                         127.0.0.1:8080 / 127.0.0.1:9099
 *   --target=prod         reads/writes live Firestore + Auth
 *                         (peer-evaluator-rubric); requires --confirm
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
import { getAuth } from 'firebase-admin/auth';
import { COLLECTIONS } from '@ops/shared';
import { initFirestore, type ImportTarget } from '../import/firebase.js';

loadDotenv();

/** Firestore caps a write batch at 500 operations; stay comfortably under. */
const BATCH_SIZE = 400;

/** Max page size `listUsers` accepts. */
const LIST_USERS_PAGE_SIZE = 1000;

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

/** One Firebase Auth user, reduced to just what the plan depends on. */
export interface AuthUserSignInState {
  /** Lowercased, to match `/staff` doc IDs. */
  email: string;
  /** `null` = this Auth account has never signed in (`metadata.lastSignInTime` unset). */
  lastSignInAtMs: number | null;
}

/** A single staff doc that needs a write. */
export interface BackfillWrite {
  email: string;
  lastSignInAtMs: number;
}

export interface BackfillPlan {
  writes: BackfillWrite[];
  /** Staff docs left untouched, with why (for the console summary). */
  skippedAlreadyStamped: string[];
  skippedNeverSignedIn: string[];
  skippedNoAuthUser: string[];
}

/**
 * Pure planner — decides what to write, given the current staff docs and the
 * Firebase Auth user records. Kept free of the Admin SDK so the decision
 * table above is readable (and reviewable) in one place.
 */
export function planLastSignInBackfill(
  staff: readonly StaffLastSignInState[],
  authUsers: readonly AuthUserSignInState[],
): BackfillPlan {
  const authByEmail = new Map(authUsers.map((u) => [u.email, u]));

  const plan: BackfillPlan = {
    writes: [],
    skippedAlreadyStamped: [],
    skippedNeverSignedIn: [],
    skippedNoAuthUser: [],
  };

  for (const row of staff) {
    // A live stamp from syncMyClaims is always at least as fresh as an Auth
    // metadata snapshot taken during this backfill run.
    if (typeof row.lastSignInAtMs === 'number') {
      plan.skippedAlreadyStamped.push(row.email);
      continue;
    }

    const authUser = authByEmail.get(row.email);
    if (!authUser) {
      plan.skippedNoAuthUser.push(row.email);
      continue;
    }

    if (authUser.lastSignInAtMs === null) {
      plan.skippedNeverSignedIn.push(row.email);
      continue;
    }

    plan.writes.push({ email: row.email, lastSignInAtMs: authUser.lastSignInAtMs });
  }

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

/** Pages through every Firebase Auth user via the Admin SDK, 1000 per page. */
async function readAuthUsers(): Promise<AuthUserSignInState[]> {
  const users: AuthUserSignInState[] = [];
  let pageToken: string | undefined;
  do {
    const page = await getAuth().listUsers(LIST_USERS_PAGE_SIZE, pageToken);
    for (const user of page.users) {
      if (!user.email) continue;
      const { lastSignInTime } = user.metadata;
      users.push({
        email: user.email.toLowerCase(),
        lastSignInAtMs: lastSignInTime ? new Date(lastSignInTime).getTime() : null,
      });
    }
    pageToken = page.pageToken;
  } while (pageToken);
  return users;
}

async function applyPlan(db: Firestore, writes: readonly BackfillWrite[]): Promise<void> {
  for (let i = 0; i < writes.length; i += BATCH_SIZE) {
    const chunk = writes.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    for (const w of chunk) {
      batch.update(db.collection(COLLECTIONS.staff).doc(w.email), {
        lastSignInAt: Timestamp.fromMillis(w.lastSignInAtMs),
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

  const [staff, authUsers] = await Promise.all([readStaff(db), readAuthUsers()]);
  console.log(
    `[backfill] read ${String(staff.length)} staff doc(s), ${String(authUsers.length)} Auth user(s)`,
  );

  const plan = planLastSignInBackfill(staff, authUsers);

  console.log('\n=== Plan ===');
  console.log(`Stamp from Auth history:   ${String(plan.writes.length)}`);
  for (const w of plan.writes) {
    console.log(`  ${w.email} → ${new Date(w.lastSignInAtMs).toISOString()}`);
  }
  console.log(`Skipped (already stamped): ${String(plan.skippedAlreadyStamped.length)}`);
  console.log(`Skipped (never signed in):${String(plan.skippedNeverSignedIn.length)}`);
  console.log(`Skipped (no Auth account):${String(plan.skippedNoAuthUser.length)}`);
  if (plan.skippedNoAuthUser.length > 0) {
    console.log('\nStaff with no matching Firebase Auth account (email mismatch, or account');
    console.log('never created — left untouched):');
    for (const e of plan.skippedNoAuthUser) console.log(`  - ${e}`);
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
