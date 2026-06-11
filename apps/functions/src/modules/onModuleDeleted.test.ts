import { describe, expect, it } from 'vitest';
import type { Firestore, Query, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { processModuleDelete, type ProcessModuleDeleteDeps } from './onModuleDeleted.js';

// ---------------------------------------------------------------------------
// Minimal Firestore stub
// ---------------------------------------------------------------------------

interface FakeDoc {
  id: string;
  ref: { update: (data: Record<string, unknown>) => void; delete: () => void };
  data: () => Record<string, unknown>;
}

interface DeleteRecord {
  type: 'recursive' | 'batch-update' | 'batch-delete';
  target: string;
  data?: Record<string, unknown>;
}

function fakeDb(opts: {
  /** Staff docs that have the moduleId in their modules array, keyed by email. */
  staffDocs?: Record<string, { modules: string[] }>;
  /** moduleProgress docs (under any staff member) for the given moduleId. */
  progressDocs?: { staffEmail: string; itemId: string }[];
  /** If true, recursiveDelete throws to simulate a failure. */
  recursiveDeleteFails?: boolean;
}): {
  db: Firestore;
  ops: DeleteRecord[];
} {
  const ops: DeleteRecord[] = [];
  const staffDocs = opts.staffDocs ?? {};
  const progressDocs = opts.progressDocs ?? [];

  // Build fake QueryDocumentSnapshots for staff docs
  function makeStaffDocs(moduleId: string, afterStartAt?: string, limit = 400): FakeDoc[] {
    const matching = Object.entries(staffDocs)
      .filter(([, data]) => data.modules.includes(moduleId))
      .map(([email, data]) => ({
        id: email,
        ref: {
          update: (upd: Record<string, unknown>) => {
            ops.push({ type: 'batch-update', target: `staff/${email}`, data: upd });
          },
          delete: () => {
            ops.push({ type: 'batch-delete', target: `staff/${email}` });
          },
        },
        data: () => data,
      }));

    // Simulate startAfter by slicing the array after the given email.
    let slice = matching;
    if (afterStartAt !== undefined) {
      const idx = matching.findIndex((d) => d.id === afterStartAt);
      slice = idx === -1 ? [] : matching.slice(idx + 1);
    }
    return slice.slice(0, limit);
  }

  // Build fake QueryDocumentSnapshots for moduleProgress docs.
  // All progress docs in the test fixture are already filtered for the module
  // being deleted — the test caller controls which docs are present.
  function makeProgressDocs(moduleId: string): FakeDoc[] {
    return progressDocs.map(({ staffEmail, itemId }) => ({
      id: itemId,
      ref: {
        update: (upd: Record<string, unknown>) => {
          ops.push({
            type: 'batch-update',
            target: `staff/${staffEmail}/moduleProgress/${itemId}`,
            data: upd,
          });
        },
        delete: () => {
          ops.push({
            type: 'batch-delete',
            target: `staff/${staffEmail}/moduleProgress/${itemId}`,
          });
        },
      },
      data: () => ({ moduleId, itemId }),
    }));
  }

  // Track what module + subcollection was recursively deleted
  const recursiveDelete = (ref: { path?: string }): Promise<number> => {
    if (opts.recursiveDeleteFails === true) {
      return Promise.reject(new Error('recursiveDelete failed'));
    }
    const target = ref.path ?? 'unknown/items';
    ops.push({ type: 'recursive', target });
    return Promise.resolve(0);
  };

  // Stub for a staff collection query chain
  let currentStartAfter: string | undefined;

  function staffQuery(filterValue: unknown, lmt: number): Query {
    return {
      limit: (n: number) => staffQuery(filterValue, n),
      startAfter: (lastDoc: QueryDocumentSnapshot) => {
        currentStartAfter = lastDoc.id;
        return staffQuery(filterValue, lmt);
      },
      get: () => {
        const docs = makeStaffDocs(filterValue as string, currentStartAfter, lmt);
        currentStartAfter = undefined;
        return Promise.resolve({
          empty: docs.length === 0,
          size: docs.length,
          docs: docs as unknown as QueryDocumentSnapshot[],
        });
      },
    } as unknown as Query;
  }

  const db: Partial<Firestore> = {
    recursiveDelete: recursiveDelete as unknown as Firestore['recursiveDelete'],

    collection: (name: string) => {
      if (name === 'modules') {
        return {
          doc: (id: string) => ({
            path: `modules/${id}`,
            collection: (sub: string) => ({
              path: `modules/${id}/${sub}`,
              parent: { id },
              id: sub,
            }),
          }),
        } as unknown as ReturnType<Firestore['collection']>;
      }
      if (name === 'staff') {
        return {
          where: (_f: string, _op: string, value: unknown) => ({
            limit: (n: number) => staffQuery(value, n),
          }),
        } as unknown as ReturnType<Firestore['collection']>;
      }
      return {} as unknown as ReturnType<Firestore['collection']>;
    },

    collectionGroup: (name: string) => {
      return {
        where: (_f: string, _op: string, moduleId: unknown) => ({
          get: () => {
            const docs = name === 'moduleProgress' ? makeProgressDocs(moduleId as string) : [];
            return Promise.resolve({
              empty: docs.length === 0,
              size: docs.length,
              docs: docs as unknown as QueryDocumentSnapshot[],
            });
          },
        }),
      } as unknown as ReturnType<Firestore['collectionGroup']>;
    },

    batch: () => {
      const batchOps: (() => void)[] = [];
      return {
        update: (
          ref: { update: (d: Record<string, unknown>) => void },
          data: Record<string, unknown>,
        ) => {
          batchOps.push(() => ref.update(data));
          return undefined;
        },
        delete: (ref: { delete: () => void }) => {
          batchOps.push(() => ref.delete());
          return undefined;
        },
        commit: () => {
          for (const op of batchOps) op();
          return Promise.resolve([]);
        },
      } as unknown as ReturnType<Firestore['batch']>;
    },
  };

  return { db: db as Firestore, ops };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const MODULE_ID = 'instructional-leadership';

describe('processModuleDelete', () => {
  it('recursively deletes the items subcollection', async () => {
    const { db, ops } = fakeDb({});
    const result = await processModuleDelete(MODULE_ID, { db } satisfies ProcessModuleDeleteDeps);

    const recursive = ops.filter((o) => o.type === 'recursive');
    expect(recursive).toHaveLength(1);
    expect(recursive[0]?.target).toContain('items');
    expect(result.itemsDeleted).toBe(true);
  });

  it('removes moduleId from each matched staff doc via arrayRemove', async () => {
    const { db, ops } = fakeDb({
      staffDocs: {
        'alice@orono.k12.mn.us': { modules: [MODULE_ID, 'other-module'] },
        'bob@orono.k12.mn.us': { modules: [MODULE_ID] },
        'carol@orono.k12.mn.us': { modules: ['other-module'] }, // not assigned
      },
    });

    const result = await processModuleDelete(MODULE_ID, { db } satisfies ProcessModuleDeleteDeps);

    const updates = ops.filter((o) => o.type === 'batch-update');
    expect(updates).toHaveLength(2);
    const targets = updates.map((o) => o.target);
    expect(targets).toContain('staff/alice@orono.k12.mn.us');
    expect(targets).toContain('staff/bob@orono.k12.mn.us');
    expect(targets).not.toContain('staff/carol@orono.k12.mn.us');
    expect(result.staffUpdated).toBe(2);
  });

  it('deletes moduleProgress docs for the module', async () => {
    const { db, ops } = fakeDb({
      progressDocs: [
        { staffEmail: 'alice@orono.k12.mn.us', itemId: 'item-1' },
        { staffEmail: 'bob@orono.k12.mn.us', itemId: 'item-2' },
      ],
    });

    const result = await processModuleDelete(MODULE_ID, { db } satisfies ProcessModuleDeleteDeps);

    const deletes = ops.filter((o) => o.type === 'batch-delete');
    expect(deletes).toHaveLength(2);
    const targets = deletes.map((o) => o.target);
    expect(targets).toContain('staff/alice@orono.k12.mn.us/moduleProgress/item-1');
    expect(targets).toContain('staff/bob@orono.k12.mn.us/moduleProgress/item-2');
    expect(result.progressDeleted).toBe(2);
  });

  it('reports correct counts when there are no assigned staff or progress docs', async () => {
    const { db } = fakeDb({});

    const result = await processModuleDelete(MODULE_ID, { db } satisfies ProcessModuleDeleteDeps);

    expect(result.staffUpdated).toBe(0);
    expect(result.progressDeleted).toBe(0);
    expect(result.itemsDeleted).toBe(true);
  });

  it('continues with staff + progress cleanup even when recursiveDelete fails', async () => {
    const { db, ops } = fakeDb({
      recursiveDeleteFails: true,
      staffDocs: {
        'alice@orono.k12.mn.us': { modules: [MODULE_ID] },
      },
      progressDocs: [{ staffEmail: 'alice@orono.k12.mn.us', itemId: 'item-1' }],
    });

    const result = await processModuleDelete(MODULE_ID, { db } satisfies ProcessModuleDeleteDeps);

    // items step failed — but other steps should still run
    expect(result.itemsDeleted).toBe(false);
    expect(result.staffUpdated).toBe(1);
    expect(result.progressDeleted).toBe(1);

    const updates = ops.filter((o) => o.type === 'batch-update');
    expect(updates).toHaveLength(1);
    const deletes = ops.filter((o) => o.type === 'batch-delete');
    expect(deletes).toHaveLength(1);
  });

  it('processes all staff and progress docs even when count is zero', async () => {
    const { db, ops } = fakeDb({
      staffDocs: {},
      progressDocs: [],
    });

    const result = await processModuleDelete(MODULE_ID, { db } satisfies ProcessModuleDeleteDeps);

    // No batch updates or deletes for staff/progress
    const batchOps = ops.filter((o) => o.type !== 'recursive');
    expect(batchOps).toHaveLength(0);
    expect(result.staffUpdated).toBe(0);
    expect(result.progressDeleted).toBe(0);
  });
});
