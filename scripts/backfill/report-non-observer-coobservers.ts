/**
 * Read-only report: observations whose co-observers include someone who
 * doesn't hold an observer role.
 *
 * Context. Co-observers read and edit a Draft and get its Drive folder
 * shared with them, so they must be a Peer Evaluator, Administrator or Full
 * Access (canCreateObservations). The setCoObservers callable now enforces
 * that for anyone *added*, but entries saved before it existed are kept so
 * the owner can still remove them. This script lists those entries so Paul
 * can decide what to do with them. It never writes.
 *
 * A co-observer is flagged when their staff doc is missing, inactive, or has
 * a role that can't observe.
 *
 * Targets (same conventions + credentials as scripts/import, scripts/export):
 *   --target=emulator     reads the Firestore emulator on 127.0.0.1:8080
 *   --target=prod         reads live Firestore (peer-evaluator-rubric)
 *
 * Auth (prod target):
 *   - gcloud auth application-default login
 *   - OR set GOOGLE_APPLICATION_CREDENTIALS to a JSON key path
 *
 * Usage:
 *   pnpm report:coobservers:prod
 */

import { config as loadDotenv } from 'dotenv';
import type { Firestore } from 'firebase-admin/firestore';
import { COLLECTIONS, OBSERVATION_STATUS, canCreateObservations } from '@ops/shared';
import { initFirestore, type ImportTarget } from '../import/firebase.js';

loadDotenv();

function parseArgs(argv: string[]): { target: ImportTarget } {
  const target = argv.find((a) => a.startsWith('--target='))?.split('=')[1];
  if (target !== 'emulator' && target !== 'prod') {
    throw new Error('Usage: --target=emulator|prod');
  }
  return { target };
}

/** The staff fields that decide whether someone may co-observe. Raw
 *  `unknown`s because Firestore reads bypass the Zod schema. */
export interface StaffObserverState {
  role: unknown;
  isActive: unknown;
}

/** One observation, reduced to what the report needs. */
export interface ObservationCoObservers {
  id: string;
  status: unknown;
  observerEmail: unknown;
  observedEmail: unknown;
  coObserverEmails: unknown;
}

export interface NonObserverRow {
  observationId: string;
  status: string;
  observerEmail: string;
  observedEmail: string;
  email: string;
  reason: 'no staff doc' | 'inactive' | 'not an observer role';
}

const REPORTED_STATUSES: readonly unknown[] = [
  OBSERVATION_STATUS.draft,
  OBSERVATION_STATUS.finalized,
];

/** Pure: every (observation, co-observer) pair that doesn't qualify. */
export function findNonObserverCoObservers(
  observations: readonly ObservationCoObservers[],
  staffByEmail: ReadonlyMap<string, StaffObserverState>,
): NonObserverRow[] {
  const rows: NonObserverRow[] = [];
  for (const obs of observations) {
    if (!REPORTED_STATUSES.includes(obs.status)) continue;
    if (!Array.isArray(obs.coObserverEmails)) continue;
    for (const raw of obs.coObserverEmails) {
      if (typeof raw !== 'string') continue;
      const email = raw.toLowerCase();
      const staff = staffByEmail.get(email);
      const reason: NonObserverRow['reason'] | null = !staff
        ? 'no staff doc'
        : staff.isActive === false
          ? 'inactive'
          : !canCreateObservations(typeof staff.role === 'string' ? staff.role : null)
            ? 'not an observer role'
            : null;
      if (!reason) continue;
      rows.push({
        observationId: obs.id,
        status: String(obs.status),
        observerEmail: String(obs.observerEmail),
        observedEmail: String(obs.observedEmail),
        email,
        reason,
      });
    }
  }
  return rows;
}

async function readObservations(db: Firestore): Promise<ObservationCoObservers[]> {
  // Firestore can't query "array is non-empty", so read all and let the
  // pure planner skip the ones without co-observers.
  const snap = await db.collection(COLLECTIONS.observations).get();
  return snap.docs.map((d) => ({
    id: d.id,
    status: d.get('status') as unknown,
    observerEmail: d.get('observerEmail') as unknown,
    observedEmail: d.get('observedEmail') as unknown,
    coObserverEmails: d.get('coObserverEmails') as unknown,
  }));
}

async function readStaff(db: Firestore): Promise<Map<string, StaffObserverState>> {
  const snap = await db.collection(COLLECTIONS.staff).get();
  return new Map(
    snap.docs.map((d) => [
      d.id.toLowerCase(),
      { role: d.get('role') as unknown, isActive: d.get('isActive') as unknown },
    ]),
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`[report] target=${args.target} (read-only)`);
  const db = initFirestore(args.target);

  const [observations, staff] = await Promise.all([readObservations(db), readStaff(db)]);
  console.log(
    `[report] read ${String(observations.length)} observation(s), ${String(staff.size)} staff doc(s)`,
  );

  const rows = findNonObserverCoObservers(observations, staff);
  console.log(`\n=== Co-observers without an observer role: ${String(rows.length)} ===`);
  for (const r of rows) {
    console.log(
      `  ${r.observationId} [${r.status}] observer=${r.observerEmail} observed=${r.observedEmail}` +
        ` co-observer=${r.email} (${r.reason})`,
    );
  }
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
