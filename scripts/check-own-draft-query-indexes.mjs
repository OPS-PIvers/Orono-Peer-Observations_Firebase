// Read-only check that every observation list query carrying the own-Draft
// gate (apps/web/src/observations/ownDraftGate.ts) has the composite index
// it needs in the live database. Each query reads at most one document.
//
//   node scripts/check-own-draft-query-indexes.mjs
//
// Uses Application Default Credentials (gcloud auth application-default
// login). Prints OK or the missing-index error (with its create link) for
// each query shape and exits non-zero if any failed.
import { initializeApp, applicationDefault, getApps } from 'firebase-admin/app';
import { Filter, getFirestore } from 'firebase-admin/firestore';
import { PROJECT_ID } from './lib/project-id.mjs';

if (getApps().length === 0) {
  initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
}

// Index needs don't depend on the values, so placeholders do.
const READER = 'index-check-reader@orono.k12.mn.us';
const OBSERVER = 'index-check-observer@orono.k12.mn.us';
const col = getFirestore().collection('observations');
const w = Filter.where;
const notOwnDraft = () =>
  Filter.or(w('observedEmail', '!=', READER), w('status', '==', 'Finalized'));
const range = (field) => [w(field, '>=', 'A'), w(field, '<=', 'A')];

const shapes = {
  'oversight: all': col.where(notOwnDraft()).orderBy('lastModifiedAt', 'desc'),
  'oversight: status filter': col
    .where(Filter.and(w('status', '==', 'Draft'), w('observedEmail', '!=', READER)))
    .orderBy('lastModifiedAt', 'desc'),
  'oversight: own person page': col
    .where(Filter.and(w('observedEmail', '==', READER), w('status', '==', 'Finalized')))
    .orderBy('lastModifiedAt', 'desc'),
};
for (const [name, scope] of [
  ['own', w('observerEmail', '==', OBSERVER)],
  ['shared', w('coObserverEmails', 'array-contains', OBSERVER)],
]) {
  shapes[`view as ${name}: all`] = col
    .where(Filter.and(scope, notOwnDraft()))
    .orderBy('lastModifiedAt', 'desc');
  shapes[`view as ${name}: status filter`] = col
    .where(Filter.and(scope, w('status', '==', 'Draft'), w('observedEmail', '!=', READER)))
    .orderBy('lastModifiedAt', 'desc');
  shapes[`view as ${name}: own person page`] = col
    .where(Filter.and(scope, w('observedEmail', '==', READER), w('status', '==', 'Finalized')))
    .orderBy('lastModifiedAt', 'desc');
}
for (const field of ['observedName', 'observationName']) {
  shapes[`search: ${field}`] = col.where(Filter.and(...range(field), notOwnDraft())).orderBy(field);
  shapes[`view as search: ${field}`] = col
    .where(Filter.and(w('observerEmail', '==', OBSERVER), ...range(field), notOwnDraft()))
    .orderBy(field);
}
shapes['search: observer email / staff directory'] = col.where(
  Filter.and(w('observerEmail', '==', OBSERVER), notOwnDraft()),
);
shapes['search: own email'] = col.where(
  Filter.and(w('observedEmail', '==', READER), w('status', '==', 'Finalized')),
);
shapes['view as search: own email'] = col.where(
  Filter.and(
    w('observerEmail', '==', OBSERVER),
    w('observedEmail', '==', READER),
    w('status', '==', 'Finalized'),
  ),
);

let failed = 0;
for (const [name, q] of Object.entries(shapes)) {
  try {
    await q.limit(1).get();
    console.log(`OK    ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`FAIL  ${name}\n      ${err instanceof Error ? err.message : String(err)}`);
  }
}
console.log(failed ? `\n${failed} query shape(s) failed.` : '\nAll query shapes are served.');
process.exit(failed ? 1 : 0);
