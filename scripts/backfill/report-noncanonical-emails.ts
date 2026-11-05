/**
 * Read-only report: staff docs and observations keyed by an address that
 * isn't a canonical staff email (lowercase, @orono.k12.mn.us).
 *
 * Context. The rules now refuse a building Administrator's staff create
 * unless the id is canonical, refuse an observation create unless
 * observedEmail names a canonical staff doc, and onStaffWritten ignores
 * non-canonical staff docs. Finalize, the creation email and the scheduled
 * reminders skip an observedEmail with no staff record. This script lists
 * existing data those changes would treat differently, so Paul can decide
 * what to do with it before they deploy. It never writes.
 *
 * Reported:
 *   - /staff docs whose id isn't canonical (with the canonical doc, if any)
 *   - Draft/Finalized observations whose observedEmail isn't canonical or has
 *     no staff doc
 *
 * Targets and auth: same as report-non-observer-coobservers.ts.
 *
 * Usage:
 *   pnpm report:noncanonical-emails:prod
 */

import { config as loadDotenv } from 'dotenv';
import type { Firestore } from 'firebase-admin/firestore';
import { COLLECTIONS, OBSERVATION_STATUS, isCanonicalStaffEmail } from '@ops/shared';
import { initFirestore, type ImportTarget } from '../import/firebase.js';

loadDotenv();

function parseArgs(argv: string[]): { target: ImportTarget } {
  const target = argv.find((a) => a.startsWith('--target='))?.split('=')[1];
  if (target !== 'emulator' && target !== 'prod') {
    throw new Error('Usage: --target=emulator|prod');
  }
  return { target };
}

export interface StaffIdRow {
  id: string;
  canonicalDocExists: boolean;
}

export interface ObservedEmailRow {
  observationId: string;
  status: string;
  observerEmail: string;
  observedEmail: string;
  reason: 'not canonical' | 'no staff doc';
}

/** Pure: staff ids that aren't canonical. */
export function findNonCanonicalStaffIds(ids: readonly string[]): StaffIdRow[] {
  const all = new Set(ids);
  const rows: StaffIdRow[] = [];
  for (const id of ids) {
    const canonical = id.trim().toLowerCase();
    if (isCanonicalStaffEmail(id)) continue;
    rows.push({ id, canonicalDocExists: all.has(canonical) });
  }
  return rows;
}

const REPORTED_STATUSES: readonly unknown[] = [
  OBSERVATION_STATUS.draft,
  OBSERVATION_STATUS.finalized,
];

/** Pure: observations whose observedEmail no longer passes the create rule. */
export function findBadObservedEmails(
  observations: readonly {
    id: string;
    status: unknown;
    observerEmail: unknown;
    observedEmail: unknown;
  }[],
  staffIds: ReadonlySet<string>,
): ObservedEmailRow[] {
  const rows: ObservedEmailRow[] = [];
  for (const obs of observations) {
    if (!REPORTED_STATUSES.includes(obs.status)) continue;
    const reason: ObservedEmailRow['reason'] | null = !isCanonicalStaffEmail(obs.observedEmail)
      ? 'not canonical'
      : !staffIds.has(obs.observedEmail)
        ? 'no staff doc'
        : null;
    if (!reason) continue;
    rows.push({
      observationId: obs.id,
      status: String(obs.status),
      observerEmail: String(obs.observerEmail),
      observedEmail: String(obs.observedEmail),
      reason,
    });
  }
  return rows;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`[report] target=${args.target} (read-only)`);
  const db: Firestore = initFirestore(args.target);

  const [staffSnap, obsSnap] = await Promise.all([
    db.collection(COLLECTIONS.staff).get(),
    db.collection(COLLECTIONS.observations).get(),
  ]);
  const staffIds = staffSnap.docs.map((d) => d.id);
  console.log(
    `[report] read ${String(staffIds.length)} staff doc(s), ${String(obsSnap.size)} observation(s)`,
  );

  const staffRows = findNonCanonicalStaffIds(staffIds);
  console.log(`\n=== Staff docs with a non-canonical id: ${String(staffRows.length)} ===`);
  for (const r of staffRows) {
    console.log(
      `  ${JSON.stringify(r.id)}${r.canonicalDocExists ? ' (canonical doc also exists)' : ''}`,
    );
  }

  const obsRows = findBadObservedEmails(
    obsSnap.docs.map((d) => ({
      id: d.id,
      status: d.get('status') as unknown,
      observerEmail: d.get('observerEmail') as unknown,
      observedEmail: d.get('observedEmail') as unknown,
    })),
    new Set(staffIds),
  );
  console.log(`\n=== Observations with an unbacked observedEmail: ${String(obsRows.length)} ===`);
  for (const r of obsRows) {
    console.log(
      `  ${r.observationId} [${r.status}] observer=${r.observerEmail}` +
        ` observed=${JSON.stringify(r.observedEmail)} (${r.reason})`,
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
