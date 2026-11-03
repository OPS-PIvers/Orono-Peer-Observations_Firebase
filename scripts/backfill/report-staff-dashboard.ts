/**
 * Read-only report: what one staff member's dashboard has to work with.
 *
 * Context. The staff dashboard (useStaffCheckpoints) finds the live draft
 * with `observedEmail == email AND type == <Standard|Work Product|
 * Instructional Round> AND status == Draft`, then runs the admin-composed
 * steps over it. My Observations lists drafts without the type filter, so an
 * observation can show there and not on the dashboard. This prints the
 * fields each of those depends on so the mismatch is visible. It never writes.
 *
 * Usage:
 *   pnpm report:staff-dashboard:prod --email=someone@orono.k12.mn.us
 */

import { config as loadDotenv } from 'dotenv';
import type { DocumentData, Firestore } from 'firebase-admin/firestore';
import {
  APP_SETTINGS_DOC_ID,
  COLLECTIONS,
  DASHBOARD_CONFIG_DOC_ID,
  OBSERVATION_TYPES,
} from '@ops/shared';
import { initFirestore, type ImportTarget } from '../import/firebase.js';

loadDotenv();

function parseArgs(argv: string[]): { target: ImportTarget; email: string } {
  const target = argv.find((a) => a.startsWith('--target='))?.split('=')[1];
  const email = argv.find((a) => a.startsWith('--email='))?.split('=')[1];
  if ((target !== 'emulator' && target !== 'prod') || !email) {
    throw new Error('Usage: --target=emulator|prod --email=<staff email>');
  }
  return { target, email: email.trim().toLowerCase() };
}

function fmt(value: unknown): string {
  if (value == null) return String(value);
  const maybe = value as { toDate?: () => Date };
  if (typeof maybe.toDate === 'function') return maybe.toDate().toISOString();
  return JSON.stringify(value);
}

function pick(data: DocumentData, fields: readonly string[]): string {
  return fields.map((f) => `${f}=${fmt(data[f])}`).join('  ');
}

async function main() {
  const { target, email } = parseArgs(process.argv.slice(2));
  console.log(`[report] target=${target} email=${email} (read-only)`);
  const db: Firestore = initFirestore(target);

  const [staff, obsSnap, viewSnap, dashConfig, settings] = await Promise.all([
    db.collection(COLLECTIONS.staff).doc(email).get(),
    db.collection(COLLECTIONS.observations).where('observedEmail', '==', email).get(),
    db.collection(COLLECTIONS.teacherViews).where('observedEmail', '==', email).get(),
    db.collection(COLLECTIONS.appSettings).doc(DASHBOARD_CONFIG_DOC_ID).get(),
    db.collection(COLLECTIONS.appSettings).doc(APP_SETTINGS_DOC_ID).get(),
  ]);

  console.log('\n=== Staff doc ===');
  if (!staff.exists) {
    console.log('  MISSING — dashboard shows "No staff record found"');
  } else {
    console.log(
      '  ' +
        pick(staff.data() ?? {}, [
          'name',
          'role',
          'year',
          'status',
          'buildings',
          'archived',
          'archivedAt',
          'isActive',
        ]),
    );
  }

  const knownTypes = new Set<unknown>(Object.values(OBSERVATION_TYPES));
  console.log(`\n=== Observations (observedEmail == email): ${String(obsSnap.size)} ===`);
  for (const d of obsSnap.docs) {
    const data = d.data();
    const typeNote = knownTypes.has(data.type) ? '' : '   <-- type not one the dashboard queries';
    console.log(`  ${d.id}${typeNote}`);
    console.log(
      '    ' +
        pick(data, [
          'type',
          'status',
          'observerEmail',
          'observationId',
          'createdAt',
          'observationDate',
          'scheduledStartAt',
          'preObsDate',
          'postObsDate',
          'cycleStatus',
          'isDemo',
        ]),
    );
  }

  console.log(`\n=== Teacher views (observedEmail == email): ${String(viewSnap.size)} ===`);
  for (const d of viewSnap.docs) {
    console.log(`  ${d.id}  ${pick(d.data(), ['type', 'status', 'createdAt'])}`);
  }

  console.log('\n=== Dashboard config steps ===');
  const steps = (dashConfig.get('steps') as DocumentData[] | undefined) ?? [];
  if (steps.length === 0) console.log('  (none stored — DEFAULT_STEPS apply)');
  for (const s of [...steps].sort((a, b) => Number(a.order) - Number(b.order))) {
    console.log(
      '  ' +
        pick(s, [
          'id',
          'enabled',
          'watchedKind',
          'showWhen',
          'doneWhen',
          'hideWhenDone',
          'completionMode',
        ]),
    );
  }
  console.log(
    '\n=== App settings ===\n  ' + pick(settings.data() ?? {}, ['reflectionUnlock', 'signupLink']),
  );
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
