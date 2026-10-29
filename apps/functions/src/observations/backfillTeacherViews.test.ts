import { describe, expect, it, vi, beforeEach } from 'vitest';

process.env['FIREBASE_CONFIG'] = JSON.stringify({ projectId: 'test' });
process.env['GCLOUD_PROJECT'] = 'test';

vi.mock('firebase-admin/app', () => ({ getApps: () => [{}], initializeApp: vi.fn() }));
vi.mock('firebase-admin/firestore', () => ({
  FieldPath: { documentId: () => '__id__' },
  FieldValue: { serverTimestamp: () => 'SERVER_TS' },
  getFirestore: vi.fn(),
}));

const { runTeacherViewBackfill, TEACHER_VIEWS_BACKFILL_MARKER } =
  await import('./backfillTeacherViews.js');

/** In-memory Firestore with just the calls the backfill makes. */
function fakeDb(opts: {
  observations: Record<string, Record<string, unknown>>;
  views?: Record<string, Record<string, unknown>>;
  marker?: boolean;
  failCreate?: string;
}) {
  const views = new Map(Object.entries(opts.views ?? {}));
  let marker: Record<string, unknown> | null = opts.marker ? { done: true } : null;
  const ids = Object.keys(opts.observations).sort();
  const page = (after: string | null, size: number) => ({
    startAfter: (id: string) => page(id, size),
    get: () => {
      const docs = ids
        .filter((id) => after === null || id > after)
        .slice(0, size)
        .map((id) => ({ id, data: () => opts.observations[id] }));
      return Promise.resolve({ empty: docs.length === 0, size: docs.length, docs });
    },
  });
  const db = {
    doc: (path: string) => {
      expect(path).toBe(TEACHER_VIEWS_BACKFILL_MARKER);
      return {
        get: () => Promise.resolve({ exists: marker !== null }),
        set: (data: Record<string, unknown>) => {
          marker = data;
          return Promise.resolve();
        },
      };
    },
    collection: (name: string) =>
      name === 'observations'
        ? { orderBy: () => ({ limit: (n: number) => page(null, n) }) }
        : {
            doc: (id: string) => ({
              create: (data: Record<string, unknown>) => {
                if (id === opts.failCreate) return Promise.reject(new Error('unavailable'));
                if (views.has(id)) {
                  return Promise.reject(Object.assign(new Error('exists'), { code: 6 }));
                }
                views.set(id, data);
                return Promise.resolve();
              },
            }),
          },
  };
  return { db: db as never, views, marker: () => marker };
}

const draft = (extra: Record<string, unknown> = {}) => ({
  status: 'Draft',
  observedEmail: 't@orono.k12.mn.us',
  observationData: { c1: { proficiency: 'x' } },
  transcripts: { a: 'secret' },
  ...extra,
});

describe('runTeacherViewBackfill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a projected view for every observation, across pages, then marks done', async () => {
    const observations: Record<string, Record<string, unknown>> = {};
    for (let i = 0; i < 450; i++) {
      observations[`o${String(i).padStart(3, '0')}`] = draft({
        draftVisibility: { ratings: i % 2 === 0 },
      });
    }
    const f = fakeDb({ observations });
    const result = await runTeacherViewBackfill(f.db);

    expect(result).toEqual({ scanned: 450, created: 450, alreadyPresent: 0 });
    expect(f.views.size).toBe(450);
    expect(f.views.get('o000')).toMatchObject({ observationId: 'o000', updatedAt: 'SERVER_TS' });
    expect(f.views.get('o000')).toHaveProperty('observationData');
    expect(f.views.get('o001')).not.toHaveProperty('observationData');
    for (const v of f.views.values()) expect(v).not.toHaveProperty('transcripts');
    expect(f.marker()).toMatchObject({ scanned: 450, created: 450 });
  });

  it('never overwrites a view the trigger already wrote', async () => {
    const f = fakeDb({
      observations: { a: draft(), b: draft() },
      views: { a: { observationId: 'a', fromTrigger: true } },
    });
    const result = await runTeacherViewBackfill(f.db);
    expect(result).toEqual({ scanned: 2, created: 1, alreadyPresent: 1 });
    expect(f.views.get('a')).toEqual({ observationId: 'a', fromTrigger: true });
  });

  it('does nothing once the marker exists', async () => {
    const f = fakeDb({ observations: { a: draft() }, marker: true });
    expect(await runTeacherViewBackfill(f.db)).toBeNull();
    expect(f.views.size).toBe(0);
  });

  it('leaves the marker unwritten when a write fails, so the next run retries', async () => {
    const f = fakeDb({ observations: { a: draft(), b: draft() }, failCreate: 'b' });
    await expect(runTeacherViewBackfill(f.db)).rejects.toThrow('unavailable');
    expect(f.marker()).toBeNull();
  });
});
