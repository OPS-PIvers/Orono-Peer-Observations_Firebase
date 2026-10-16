import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

process.env['FIREBASE_CONFIG'] = JSON.stringify({ projectId: 'test' });
process.env['GCLOUD_PROJECT'] = 'test';

type AnyMock = Mock<(...args: unknown[]) => unknown>;

const state = vi.hoisted(() => ({
  set: undefined as AnyMock | undefined,
  del: undefined as AnyMock | undefined,
  /** The observation as a fresh read returns it; undefined = deleted. */
  current: undefined as Record<string, unknown> | undefined,
}));

vi.mock('firebase-admin/app', () => ({
  getApps: () => [{}],
  initializeApp: vi.fn(),
}));

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'SERVER_TS' },
  getFirestore: () => ({
    collection: (name: string) => ({
      doc: (id: string) =>
        name === 'teacherViews'
          ? {
              set: (...args: unknown[]) => state.set?.(id, ...args),
              delete: () => state.del?.(id),
            }
          : { get: () => Promise.resolve({ data: () => state.current }) },
    }),
  }),
}));

const { handleTeacherView } = await import('./onObservationTeacherView.js');

type Doc = Record<string, unknown> | null;

/** Build a Firestore-write event with the shape the handler reads. */
function makeEvent(before: Doc, after: Doc) {
  return {
    params: { observationId: 'obs1' },
    data: {
      before: { exists: before != null, data: () => before ?? undefined },
      after: { exists: after != null, data: () => after ?? undefined },
    },
  } as never;
}

/** Fires the handler for before → after, with the fresh read returning `after`. */
async function write(before: Doc, after: Doc) {
  state.current = after ?? undefined;
  await (handleTeacherView as unknown as (e: never) => Promise<unknown>)(makeEvent(before, after));
}

/** Firestore-like Timestamp: separate instances, equal millis. */
const ts = (ms: number) => ({ toMillis: () => ms, seconds: ms / 1000 });

const HIDDEN = {
  ratings: false,
  notes: false,
  evidence: false,
  script: false,
  meetingNotes: false,
};
const base = {
  observationId: 'obs1',
  status: 'Draft',
  observedEmail: 'teacher@orono.k12.mn.us',
  observerEmail: 'pe@orono.k12.mn.us',
  createdAt: ts(1000),
  lastModifiedAt: ts(1000),
  draftVisibility: HIDDEN,
  observationData: {},
};

const written = () => state.set?.mock.calls[0]?.[1] as Record<string, unknown> | undefined;

beforeEach(() => {
  state.set = vi.fn().mockResolvedValue(undefined);
  state.del = vi.fn().mockResolvedValue(undefined);
});

describe('handleTeacherView', () => {
  it('writes the view on create', async () => {
    await write(null, base);
    expect(state.set).toHaveBeenCalledTimes(1);
    expect(state.set?.mock.calls[0]?.[0]).toBe('obs1');
    expect(written()).toMatchObject({
      observationId: 'obs1',
      status: 'Draft',
      updatedAt: 'SERVER_TS',
    });
    expect(written()).not.toHaveProperty('observationData');
    expect(written()).not.toHaveProperty('lastModifiedAt');
  });

  it('skips the write when an autosave changes only hidden ratings', async () => {
    await write(
      { ...base, createdAt: ts(1000) },
      {
        ...base,
        createdAt: ts(1000),
        lastModifiedAt: ts(2000),
        observationData: { c1: { proficiency: 'proficient' } },
      },
    );
    expect(state.set).not.toHaveBeenCalled();
    expect(state.del).not.toHaveBeenCalled();
  });

  it('writes when the same change is made with ratings shared', async () => {
    const shared = { ...base, draftVisibility: { ...HIDDEN, ratings: true } };
    const data = { c1: { proficiency: 'proficient' } };
    await write(shared, { ...shared, observationData: data });
    expect(written()).toMatchObject({ observationData: data });
  });

  it('writes the ratings when draftVisibility.ratings is switched on', async () => {
    const data = { c1: { proficiency: 'proficient' } };
    await write(
      { ...base, observationData: data },
      { ...base, observationData: data, draftVisibility: { ...HIDDEN, ratings: true } },
    );
    expect(written()).toMatchObject({
      observationData: data,
      draftVisibility: { ratings: true },
    });
  });

  it('projects the observation as it is now, not as a late event saw it', async () => {
    const data = { c1: { proficiency: 'proficient' } };
    state.current = { ...base, observationData: data };
    await (handleTeacherView as unknown as (e: never) => Promise<unknown>)(
      makeEvent(
        { ...base, observationData: data },
        { ...base, observationData: data, draftVisibility: { ...HIDDEN, ratings: true } },
      ),
    );
    expect(written()).not.toHaveProperty('observationData');
  });

  it('deletes the view when the observation is deleted', async () => {
    await write(base, null);
    expect(state.del).toHaveBeenCalledWith('obs1');
    expect(state.set).not.toHaveBeenCalled();
  });

  it('writes Finalized status through', async () => {
    await write(base, { ...base, status: 'Finalized', finalizedAt: ts(3000) });
    expect(written()).toMatchObject({ status: 'Finalized' });
    expect(written()?.['finalizedAt']).toBeDefined();
  });
});
