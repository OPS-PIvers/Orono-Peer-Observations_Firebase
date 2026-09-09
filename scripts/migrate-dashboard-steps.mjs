/**
 * One-time migration: rewrite /appSettings/dashboard.steps to the current
 * DEFAULT_STEPS (Planning / Reflection cards replace preObs / postObs /
 * workProduct / instructionalRound).
 *
 * `resolveSteps` returns a saved `steps` array verbatim, so edits to
 * DEFAULT_STEPS are invisible in production until the stored array is
 * rewritten. Production's stored steps were verified identical to the OLD
 * defaults (nobody customized them — someone saved the admin tab). This
 * script re-verifies that before writing and bails loudly if anything has
 * been customized since, because a rewrite would silently discard it.
 *
 * Usage (prod, Application Default Credentials — see check-staff.mjs):
 *   node scripts/migrate-dashboard-steps.mjs --dry-run
 *   node scripts/migrate-dashboard-steps.mjs
 * Emulator:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/migrate-dashboard-steps.mjs
 * Override the safety check (only after reading the diff it prints):
 *   node scripts/migrate-dashboard-steps.mjs --force
 */
import { initializeApp, applicationDefault, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { DEFAULT_STEPS, dashboardStep } from '@ops/shared';
import { PROJECT_ID } from './lib/project-id.mjs';

const dryRun = process.argv.includes('--dry-run');
const force = process.argv.includes('--force');

if (getApps().length === 0) {
  initializeApp(
    process.env.FIRESTORE_EMULATOR_HOST
      ? { projectId: PROJECT_ID }
      : { credential: applicationDefault(), projectId: PROJECT_ID },
  );
}

/** The 8 steps as they were before this migration — frozen here on purpose
 *  so the check keeps working after DEFAULT_STEPS changes again. */
const OLD_DEFAULT_STEPS = [
  {
    id: 'signup',
    order: 0,
    watchedKind: 'standard',
    chipStyle: 'meeting',
    chipLabel: 'Scheduling',
    title: 'Sign up for an observation window',
    description:
      'Pick a window that works for your class. Your peer evaluator confirms within 2 school days.',
    buttonLabel: 'Choose a window',
    showWhen: 'signupWindowOpened',
    doneWhen: 'signupSlotBooked',
    dateFrom: 'windowEndDate',
    buttonTarget: 'booking',
  },
  {
    id: 'preObs',
    order: 1,
    watchedKind: 'standard',
    chipStyle: 'meeting',
    chipLabel: 'Meeting',
    title: 'Pre-observation conversation',
    description:
      '20-minute conversation with your peer evaluator. Lesson plan, focus components, context.',
    buttonLabel: 'View meeting',
    showWhen: 'preObsDateSet',
    doneWhen: 'preObsDatePassed',
    dateFrom: 'preObsDate',
    buttonTarget: 'observation',
  },
  {
    id: 'workProduct',
    order: 2,
    watchedKind: 'workProduct',
    chipStyle: 'form',
    chipLabel: 'Evidence',
    title: 'Submit work-product responses',
    description:
      'Short prompts about your planning, family communication, and growth. Save and resume any time.',
    buttonLabel: 'Continue answering',
    showWhen: 'observationCreated',
    doneWhen: 'finalized',
    dateFrom: 'lastModifiedAt',
    inProgress: 'responseProgress',
    buttonTarget: 'fixedUrl',
    buttonUrl: '/my-rubric',
  },
  {
    id: 'observation',
    order: 3,
    watchedKind: 'standard',
    chipStyle: 'observation',
    chipLabel: 'Observation',
    title: 'Classroom observation',
    description: 'Your peer evaluator joins your room during the window you selected.',
    buttonLabel: 'View details',
    showWhen: 'observationDateSet',
    doneWhen: 'observationDatePassed',
    dateFrom: 'observationDate',
    buttonTarget: 'observation',
  },
  {
    id: 'reviewDraft',
    order: 4,
    watchedKind: 'anyDraft',
    chipStyle: 'review',
    chipLabel: 'Review',
    title: 'Review the draft observation',
    description: 'Your peer evaluator is drafting your observation. You can view and comment now.',
    buttonLabel: 'Open draft',
    showWhen: 'observationCreated',
    doneWhen: 'finalized',
    dateFrom: 'lastModifiedAt',
    buttonTarget: 'observation',
  },
  {
    id: 'postObs',
    order: 5,
    watchedKind: 'standard',
    chipStyle: 'meeting',
    chipLabel: 'Meeting',
    title: 'Post-observation conversation',
    description: '30 minutes to talk through proficiency ratings and where to focus next.',
    buttonLabel: 'View meeting',
    showWhen: 'postObsDateSet',
    doneWhen: 'postObsDatePassed',
    dateFrom: 'postObsDate',
    buttonTarget: 'observation',
  },
  {
    id: 'acknowledge',
    order: 6,
    watchedKind: 'standardFinalized',
    chipStyle: 'review',
    chipLabel: 'Sign-off',
    title: 'Acknowledge the finalized observation',
    description: 'Acknowledging stores your sign-off on the finalized observation record.',
    buttonLabel: 'Acknowledge',
    showWhen: 'finalized',
    doneWhen: 'acknowledged',
    dateFrom: 'finalizedAt',
    buttonTarget: 'acknowledge',
  },
  {
    id: 'instructionalRound',
    order: 7,
    watchedKind: 'instructionalRound',
    chipStyle: 'observation',
    chipLabel: 'Round',
    title: 'Instructional Round',
    description: 'Reflective responses for this instructional round.',
    buttonLabel: 'View details',
    showWhen: 'observationCreated',
    doneWhen: 'finalized',
    dateFrom: 'createdAt',
    inProgress: 'responseProgress',
    buttonTarget: 'fixedUrl',
    buttonUrl: '/my-rubric',
  },
].map((s) => dashboardStep.parse(s));

/** Stable, key-order-independent fingerprint of a step. `openPanel` is new
 *  and absent from stored docs, so a null value and a missing key compare
 *  equal. */
function fingerprint(step) {
  const entries = Object.entries(step)
    .filter(([k, v]) => !(k === 'openPanel' && v == null))
    .sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(entries);
}

function describeDiff(stored, expected) {
  const lines = [];
  const storedById = new Map(stored.map((s) => [s.id, s]));
  const expectedById = new Map(expected.map((s) => [s.id, s]));
  for (const id of new Set([...storedById.keys(), ...expectedById.keys()])) {
    const a = storedById.get(id);
    const b = expectedById.get(id);
    if (!a) lines.push(`  - step "${id}" missing from stored config`);
    else if (!b) lines.push(`  - stored has extra step "${id}"`);
    else if (fingerprint(a) !== fingerprint(b)) {
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
        if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) {
          lines.push(
            `  - "${id}".${key}: ${JSON.stringify(a[key])} → expected ${JSON.stringify(b[key])}`,
          );
        }
      }
    }
  }
  return lines.join('\n');
}

const ref = getFirestore().doc('appSettings/dashboard');
const snap = await ref.get();
if (!snap.exists) {
  console.log(
    'No /appSettings/dashboard doc — resolveSteps already falls back to DEFAULT_STEPS. Nothing to do.',
  );
  process.exit(0);
}
const data = snap.data() ?? {};
const stored = Array.isArray(data.steps) ? data.steps : [];
if (stored.length === 0) {
  console.log('Stored `steps` is empty — resolveSteps already uses DEFAULT_STEPS. Nothing to do.');
  process.exit(0);
}

const storedParsed = stored.map((s) => dashboardStep.parse(s));
const matchesOld =
  storedParsed.length === OLD_DEFAULT_STEPS.length &&
  storedParsed.every((s, i) => fingerprint(s) === fingerprint(OLD_DEFAULT_STEPS[i]));
const matchesNew =
  storedParsed.length === DEFAULT_STEPS.length &&
  storedParsed.every((s, i) => fingerprint(s) === fingerprint(DEFAULT_STEPS[i]));

if (matchesNew) {
  console.log('Stored steps already match the current DEFAULT_STEPS. Nothing to do.');
  process.exit(0);
}

if (!matchesOld && !force) {
  console.error(
    'REFUSING TO MIGRATE: stored steps differ from the pre-migration defaults, so someone has customized them.\n' +
      'Rewriting would discard those edits. Review the diff below; re-run with --force only if that is intended.\n',
  );
  console.error(describeDiff(storedParsed, OLD_DEFAULT_STEPS));
  process.exit(1);
}

console.log(
  `${matchesOld ? 'Stored steps match the pre-migration defaults.' : '--force: skipping the safety check.'}\n` +
    `Rewriting ${String(storedParsed.length)} steps → ${String(DEFAULT_STEPS.length)} steps:\n` +
    DEFAULT_STEPS.map((s) => `  ${String(s.order)}. ${s.id} — ${s.title}`).join('\n'),
);

if (dryRun) {
  console.log('\n--dry-run: no write performed.');
  process.exit(0);
}

await ref.set(
  {
    steps: DEFAULT_STEPS,
    // `updatedBy` is schema'd as an email; leave whatever the admin UI last
    // wrote rather than stamping a script name that would fail validation.
    updatedAt: FieldValue.serverTimestamp(),
  },
  { merge: true },
);
console.log('\nDone. /appSettings/dashboard.steps rewritten.');
