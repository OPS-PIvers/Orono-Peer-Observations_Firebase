import { beforeEach, describe, expect, it, vi } from 'vitest';

process.env['FIREBASE_CONFIG'] = JSON.stringify({ projectId: 'test' });
process.env['GCLOUD_PROJECT'] = 'test';

const state = vi.hoisted(() => ({
  synced: [] as string[],
  failOn: null as string | null,
}));

vi.mock('firebase-admin/app', () => ({ getApps: () => [{}], initializeApp: vi.fn() }));
vi.mock('firebase-admin/firestore', () => ({
  FieldPath: { documentId: () => '__id__' },
  FieldValue: { serverTimestamp: () => 'SERVER_TS' },
  getFirestore: vi.fn(),
}));
vi.mock('./onObservationWindowInviteViews.js', () => ({
  syncWindowInviteViews: (_db: unknown, id: string) => {
    if (id === state.failOn) return Promise.reject(new Error('boom'));
    state.synced.push(id);
    return Promise.resolve({ written: 2, deleted: id === 'w-removed' ? 1 : 0 });
  },
}));

const { resyncOpenWindows, runWindowInviteViewBackfill, WINDOW_INVITE_VIEWS_BACKFILL_MARKER } =
  await import('./backfillWindowInviteViews.js');

/** In-memory Firestore with just the calls the backfill makes. */
function fakeDb(windowIds: string[], markerExists = false) {
  let marker: Record<string, unknown> | null = markerExists ? { done: true } : null;
  const ids = [...windowIds].sort();
  const page = (after: string | null, size: number) => ({
    startAfter: (id: string) => page(id, size),
    get: () => {
      const docs = ids
        .filter((id) => after === null || id > after)
        .slice(0, size)
        .map((id) => ({ id }));
      return Promise.resolve({ empty: docs.length === 0, size: docs.length, docs });
    },
  });
  const db = {
    doc: (path: string) => {
      expect(path).toBe(WINDOW_INVITE_VIEWS_BACKFILL_MARKER);
      return {
        get: () => Promise.resolve({ exists: marker !== null }),
        set: (data: Record<string, unknown>) => {
          marker = data;
          return Promise.resolve();
        },
      };
    },
    collection: () => ({
      orderBy: () => ({ select: () => ({ limit: (n: number) => page(null, n) }) }),
      // Open windows: ids starting "open-".
      where: (field: string, op: string, statuses: string[]) => {
        expect([field, op, statuses]).toEqual(['status', 'in', ['open', 'partially-booked']]);
        return {
          select: () => ({
            get: () =>
              Promise.resolve({
                docs: ids.filter((id) => id.startsWith('open-')).map((id) => ({ id })),
              }),
          }),
        };
      },
    }),
  };
  return { db: db as never, marker: () => marker };
}

beforeEach(() => {
  state.synced = [];
  state.failOn = null;
});

describe('runWindowInviteViewBackfill', () => {
  it('syncs every window across pages and records the marker', async () => {
    const ids = Array.from({ length: 450 }, (_, i) => `w${String(i).padStart(3, '0')}`);
    ids.push('w-removed');
    const { db, marker } = fakeDb(ids);

    const result = await runWindowInviteViewBackfill(db);

    expect(result).toEqual({ windows: 451, viewsWritten: 902, viewsDeleted: 1 });
    expect(new Set(state.synced)).toEqual(new Set(ids));
    expect(marker()).toEqual({ ...result, completedAt: 'SERVER_TS' });
  });

  it('is a no-op once the marker exists', async () => {
    const { db } = fakeDb(['w1'], true);
    expect(await runWindowInviteViewBackfill(db)).toBeNull();
    expect(state.synced).toEqual([]);
  });

  it('leaves the marker unwritten when a window fails, so the next run retries', async () => {
    state.failOn = 'w2';
    const { db, marker } = fakeDb(['w1', 'w2', 'w3']);
    await expect(runWindowInviteViewBackfill(db)).rejects.toThrow('boom');
    expect(marker()).toBeNull();
  });

  it('after the marker, re-syncs only open windows', async () => {
    const { db } = fakeDb(['open-1', 'open-2', 'closed-1'], true);
    const result = await resyncOpenWindows(db);
    expect(state.synced.sort()).toEqual(['open-1', 'open-2']);
    expect(result).toEqual({ windows: 2, viewsWritten: 4, viewsDeleted: 0 });
  });
});
