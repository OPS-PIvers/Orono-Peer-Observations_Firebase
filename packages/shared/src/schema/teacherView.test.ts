import { describe, expect, it } from 'vitest';
import {
  TEACHER_VIEW_ALWAYS_FIELDS,
  TEACHER_VIEW_FLAGGED_FIELDS,
  TEACHER_VIEW_NEVER_FIELDS,
  teacherViewOf,
} from './teacherView.js';

const ALL_OFF = {
  ratings: false,
  notes: false,
  evidence: false,
  script: false,
  meetingNotes: false,
};
const ALL_ON = { ratings: true, notes: true, evidence: true, script: true, meetingNotes: true };

/** A Draft with every field populated, flags supplied per test. */
function fullObs(draftVisibility?: Record<string, unknown>): Record<string, unknown> {
  const obs: Record<string, unknown> = {};
  for (const f of TEACHER_VIEW_ALWAYS_FIELDS) obs[f] = `v:${f}`;
  for (const fields of Object.values(TEACHER_VIEW_FLAGGED_FIELDS)) {
    for (const f of fields) obs[f] = `v:${f}`;
  }
  for (const f of TEACHER_VIEW_NEVER_FIELDS) obs[f] = `v:${f}`;
  obs['status'] = 'Draft';
  if (draftVisibility) obs['draftVisibility'] = draftVisibility;
  else delete obs['draftVisibility'];
  return obs;
}

const flaggedFields = Object.values(TEACHER_VIEW_FLAGGED_FIELDS).flat();

describe('teacherViewOf', () => {
  it('sets observationId from the document id', () => {
    expect(teacherViewOf({ observationId: 'stale' }, 'obs1')['observationId']).toBe('obs1');
  });

  it('copies every always-included field', () => {
    const view = teacherViewOf(fullObs(ALL_OFF), 'obs1');
    for (const f of TEACHER_VIEW_ALWAYS_FIELDS) expect(view).toHaveProperty(f);
  });

  it('includes no content fields when every flag is off', () => {
    const view = teacherViewOf(fullObs(ALL_OFF), 'obs1');
    for (const f of flaggedFields) expect(view).not.toHaveProperty(f);
  });

  it('treats a missing draftVisibility as every flag off', () => {
    const view = teacherViewOf(fullObs(), 'obs1');
    for (const f of flaggedFields) expect(view).not.toHaveProperty(f);
    expect(view).not.toHaveProperty('draftVisibility');
  });

  it('treats a partial or non-boolean draftVisibility flag as off', () => {
    const view = teacherViewOf(fullObs({ ratings: 'yes' }), 'obs1');
    expect(view).not.toHaveProperty('observationData');
  });

  it.each(Object.entries(TEACHER_VIEW_FLAGGED_FIELDS))(
    'includes exactly the %s fields when only that flag is on',
    (flag, fields) => {
      const view = teacherViewOf(fullObs({ ...ALL_OFF, [flag]: true }), 'obs1');
      for (const f of flaggedFields) {
        if ((fields as readonly string[]).includes(f)) expect(view[f]).toBe(`v:${f}`);
        else expect(view).not.toHaveProperty(f);
      }
    },
  );

  it('never includes the never-included fields, even with every flag on', () => {
    const view = teacherViewOf(fullObs(ALL_ON), 'obs1');
    for (const f of TEACHER_VIEW_NEVER_FIELDS) expect(view).not.toHaveProperty(f);
  });

  it('drops unknown extra fields', () => {
    const view = teacherViewOf({ ...fullObs(ALL_ON), someFutureField: 'secret' }, 'obs1');
    expect(view).not.toHaveProperty('someFutureField');
  });

  it('leaves absent fields absent rather than undefined', () => {
    const view = teacherViewOf({ status: 'Draft', observedEmail: 't@orono.k12.mn.us' }, 'obs1');
    expect(Object.keys(view).sort()).toEqual(['observationId', 'observedEmail', 'status']);
  });
});
