import { beforeEach, describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import type { CallableRequest } from 'firebase-functions/v2/https';
import {
  APP_SETTINGS_DOC_ID,
  COLLECTIONS,
  OBSERVATION_STATUS,
  roleYearMappingDocId,
  type TiptapDoc,
} from '@ops/shared';

process.env['FIREBASE_CONFIG'] = JSON.stringify({ projectId: 'test' });
process.env['GCLOUD_PROJECT'] = 'test';

interface HState {
  db: unknown;
}

const h = vi.hoisted((): HState => ({ db: undefined }));

vi.mock('firebase-admin/app', () => ({ getApps: () => [{}], initializeApp: vi.fn() }));

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => h.db,
  FieldValue: { serverTimestamp: () => '__server_ts__' },
}));

const { applyScriptTags } = await import('./applyScriptTags.js');

const run = (req: Partial<CallableRequest>) =>
  (applyScriptTags as unknown as { run: (r: unknown) => Promise<unknown> }).run(req);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const OBSERVER = 'observer@orono.k12.mn.us';
const OBS_ID = 'obs-1';

function scriptDoc(...paragraphs: string[]): TiptapDoc {
  return {
    type: 'doc',
    content: paragraphs.map((text) => ({
      type: 'paragraph',
      content: [{ type: 'text', text }],
    })),
  } as unknown as TiptapDoc;
}

const ORIGINAL_SCRIPT = scriptDoc('Students turned and talked.', 'The teacher circulated.');

function observation(over: Record<string, unknown> = {}) {
  return {
    status: OBSERVATION_STATUS.draft,
    observerEmail: OBSERVER,
    observedRole: 'teacher',
    observedYear: 1,
    scriptDoc: ORIGINAL_SCRIPT,
    ...over,
  };
}

interface DbConfig {
  /** Doc returned by the plain (pre-transaction) observation read. */
  observation: Record<string, unknown> | null;
  /**
   * Doc returned by the read *inside* the transaction. Defaults to the same
   * object; set it to model the observer editing the script — or an admin
   * finalizing the observation — mid-review.
   */
  observationInTransaction?: Record<string, unknown> | null;
  /** Components assigned to this role/year on the pre-transaction read. */
  assignedComponentIds?: string[];
  /**
   * Components assigned on the read *inside* the transaction. Defaults to the
   * same list; set it to model a role/year mapping edited mid-review.
   */
  assignedComponentIdsInTransaction?: string[];
  settings?: Record<string, unknown>;
}

interface Recorder {
  txUpdates: Record<string, unknown>[];
}

/** Marker fields the fake attaches so the fake transaction can route reads. */
interface FakeDocRef {
  path: string;
  get: () => Promise<unknown>;
}
interface FakeQuery {
  collectionName: string;
  filters: [string, unknown][];
  get: () => Promise<unknown>;
}

function buildDb(config: DbConfig): { db: unknown; rec: Recorder } {
  const rec: Recorder = { txUpdates: [] };
  const obsPath = `${COLLECTIONS.observations}/${OBS_ID}`;
  const mappingPath = `${COLLECTIONS.roleYearMappings}/${roleYearMappingDocId('teacher', 1)}`;
  const txObservation =
    config.observationInTransaction === undefined
      ? config.observation
      : config.observationInTransaction;
  const assigned = config.assignedComponentIds ?? ['1a', '2b'];
  const txAssigned = config.assignedComponentIdsInTransaction ?? assigned;

  const staticDocs: Record<string, Record<string, unknown> | undefined> = {
    [`${COLLECTIONS.appSettings}/${APP_SETTINGS_DOC_ID}`]: config.settings,
    [`${COLLECTIONS.rubrics}/rubric-1`]: {
      rubricId: 'rubric-1',
      domains: [
        {
          id: 'd1',
          components: [
            { id: '1a', title: 'Knowledge of Content', color: { bg: '#dbeafe', fg: '#1e3a8a' } },
            { id: '2b', title: 'Culture for Learning', color: { bg: '#dcfce7', fg: '#14532d' } },
          ],
        },
      ],
    },
  };

  /**
   * `inTransaction` is what makes the mid-review race testable: the same path
   * can answer differently depending on whether the caller read it before the
   * transaction or from inside it.
   */
  function docData(path: string, inTransaction: boolean) {
    if (path === obsPath) return (inTransaction ? txObservation : config.observation) ?? undefined;
    if (path === mappingPath) {
      return {
        roleId: 'teacher',
        year: 1,
        assignedComponentIds: inTransaction ? txAssigned : assigned,
      };
    }
    return staticDocs[path];
  }

  function snapshot(path: string, inTransaction: boolean) {
    const data = docData(path, inTransaction);
    return { exists: data !== undefined, id: path.split('/').pop() ?? '', data: () => data };
  }

  function runQuery(collectionName: string, filters: [string, unknown][]) {
    let rows: (Record<string, unknown> & { id?: string })[] =
      collectionName === COLLECTIONS.roles
        ? [{ id: 'r1', roleId: 'teacher', displayName: 'Teacher', rubricId: 'rubric-1' }]
        : [];
    for (const [f, v] of filters) rows = rows.filter((r) => r[f] === v);
    const rowDocs = rows.map((r) => ({ id: r.id ?? 'doc', data: () => r }));
    return { empty: rowDocs.length === 0, docs: rowDocs };
  }

  function collection(name: string): FakeQuery {
    const filters: [string, unknown][] = [];
    const q: FakeQuery & {
      where: (field: string, op: string, val: unknown) => FakeQuery;
      limit: () => FakeQuery;
    } = {
      collectionName: name,
      filters,
      where(field: string, _op: string, val: unknown) {
        filters.push([field, val]);
        return q;
      },
      limit() {
        return q;
      },
      get: () => Promise.resolve(runQuery(name, filters)),
    };
    return q;
  }

  function doc(path: string): FakeDocRef {
    return { path, get: () => Promise.resolve(snapshot(path, false)) };
  }

  function runTransaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
    let hasWritten = false;
    const tx = {
      get: (target: FakeDocRef | FakeQuery) => {
        // Firestore rejects a read issued after a write in the same
        // transaction — surface that here rather than letting a re-ordered
        // re-validation pass silently in tests and fail in production.
        if (hasWritten) {
          throw new Error('transaction read after write');
        }
        if ('path' in target) return Promise.resolve(snapshot(target.path, true));
        return Promise.resolve(runQuery(target.collectionName, target.filters));
      },
      update: (_ref: unknown, patch: Record<string, unknown>) => {
        hasWritten = true;
        rec.txUpdates.push(patch);
      },
    };
    return fn(tx);
  }

  return { db: { collection, doc, runTransaction }, rec };
}

function callerRequest(data: Record<string, unknown>): Partial<CallableRequest> {
  return {
    auth: { uid: 'uid-1', token: { email: OBSERVER } },
    data,
  } as unknown as Partial<CallableRequest>;
}

interface ApplyResult {
  appliedCount: number;
  rejectedCount: number;
  scriptDoc: TiptapDoc;
}

interface TextNode {
  type?: string;
  text?: string;
  marks?: { type?: string; attrs?: Record<string, unknown> }[];
  content?: TextNode[];
}

function taggedTexts(d: TiptapDoc): string[] {
  const out: string[] = [];
  function walk(node: TextNode | undefined): void {
    if (!node) return;
    if (
      node.type === 'text' &&
      typeof node.text === 'string' &&
      node.marks?.some((m) => m.type === 'componentTag')
    ) {
      out.push(node.text);
    }
    for (const child of node.content ?? []) walk(child);
  }
  walk(d as unknown as TextNode);
  return out;
}

let rec: Recorder;

function install(config: DbConfig) {
  const built = buildDb(config);
  h.db = built.db;
  rec = built.rec;
}

beforeEach(() => {
  install({ observation: observation() });
});

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

describe('applyScriptTags — input & auth guards', () => {
  it('rejects an unauthenticated call', async () => {
    await expect(run({ data: { observationId: OBS_ID } })).rejects.toThrow(/Sign in required/);
  });

  it('requires an observationId', async () => {
    await expect(run(callerRequest({ suggestions: [] }))).rejects.toThrow(/observationId required/);
  });

  it('rejects an empty suggestion list', async () => {
    await expect(run(callerRequest({ observationId: OBS_ID, suggestions: [] }))).rejects.toThrow(
      /non-empty array/,
    );
  });

  it('rejects a malformed suggestion entry', async () => {
    await expect(
      run(
        callerRequest({
          observationId: OBS_ID,
          suggestions: [{ paragraphIndex: 'zero', text: 'turned', componentId: '1a' }],
        }),
      ),
    ).rejects.toThrow(/paragraphIndex/);
  });

  it('rejects a caller who is neither the observer nor an admin', async () => {
    const req = {
      auth: { uid: 'uid-2', token: { email: 'someone@orono.k12.mn.us' } },
      data: {
        observationId: OBS_ID,
        suggestions: [{ paragraphIndex: 0, text: 'turned and talked', componentId: '1a' }],
      },
    } as unknown as Partial<CallableRequest>;
    await expect(run(req)).rejects.toThrow(/Only the observer or an admin/);
    expect(rec.txUpdates).toHaveLength(0);
  });

  it('refuses to touch a finalized observation', async () => {
    install({ observation: observation({ status: OBSERVATION_STATUS.finalized }) });
    await expect(
      run(
        callerRequest({
          observationId: OBS_ID,
          suggestions: [{ paragraphIndex: 0, text: 'turned and talked', componentId: '1a' }],
        }),
      ),
    ).rejects.toThrow(/finalized/);
    expect(rec.txUpdates).toHaveLength(0);
  });

  it('refuses to run when an admin has disabled script auto-tagging', async () => {
    install({
      observation: observation(),
      settings: { gemini: { scriptAutoTag: { enabled: false } } },
    });
    await expect(
      run(
        callerRequest({
          observationId: OBS_ID,
          suggestions: [{ paragraphIndex: 0, text: 'turned and talked', componentId: '1a' }],
        }),
      ),
    ).rejects.toThrow(/disabled by an admin/);
    expect(rec.txUpdates).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('applyScriptTags — writing approved spans', () => {
  it('marks the approved spans and returns the new script', async () => {
    const res = (await run(
      callerRequest({
        observationId: OBS_ID,
        suggestions: [
          { paragraphIndex: 0, text: 'turned and talked', componentId: '1a' },
          { paragraphIndex: 1, text: 'circulated', componentId: '2b' },
        ],
      }),
    )) as ApplyResult;

    expect(res.appliedCount).toBe(2);
    expect(res.rejectedCount).toBe(0);
    expect(taggedTexts(res.scriptDoc)).toEqual(['turned and talked', 'circulated']);
    expect(rec.txUpdates).toHaveLength(1);
    expect(rec.txUpdates[0]?.['lastModifiedAt']).toBe('__server_ts__');
    expect(taggedTexts(rec.txUpdates[0]?.['scriptDoc'] as TiptapDoc)).toEqual([
      'turned and talked',
      'circulated',
    ]);
  });

  it('ignores extra fields the review dialog carried alongside each suggestion', async () => {
    const res = (await run(
      callerRequest({
        observationId: OBS_ID,
        suggestions: [
          {
            paragraphIndex: 0,
            text: 'turned and talked',
            componentId: '1a',
            componentTitle: 'Knowledge of Content',
            paragraphText: 'Students turned and talked.',
          },
        ],
      }),
    )) as ApplyResult;

    expect(res.appliedCount).toBe(1);
    expect(taggedTexts(res.scriptDoc)).toEqual(['turned and talked']);
  });
});

// ---------------------------------------------------------------------------
// Stale-review rejection — the reason this callable re-validates at all
// ---------------------------------------------------------------------------

describe('applyScriptTags — stale suggestion rejection', () => {
  it('drops a span whose text no longer appears in its paragraph', async () => {
    const res = (await run(
      callerRequest({
        observationId: OBS_ID,
        suggestions: [{ paragraphIndex: 0, text: 'worked in small groups', componentId: '1a' }],
      }),
    )) as ApplyResult;

    expect(res.appliedCount).toBe(0);
    expect(res.rejectedCount).toBe(1);
    // Nothing was written — the script is returned untouched.
    expect(rec.txUpdates).toHaveLength(0);
    expect(taggedTexts(res.scriptDoc)).toEqual([]);
  });

  it('re-validates against the script read inside the transaction, not the earlier read', async () => {
    // The observer deleted the tagged sentence between the review dialog
    // opening and "Apply" being pressed; the second paragraph survived.
    install({
      observation: observation(),
      observationInTransaction: observation({
        scriptDoc: scriptDoc('Students worked alone.', 'The teacher circulated.'),
      }),
    });

    const res = (await run(
      callerRequest({
        observationId: OBS_ID,
        suggestions: [
          { paragraphIndex: 0, text: 'turned and talked', componentId: '1a' },
          { paragraphIndex: 1, text: 'circulated', componentId: '2b' },
        ],
      }),
    )) as ApplyResult;

    expect(res.appliedCount).toBe(1);
    expect(res.rejectedCount).toBe(1);
    expect(taggedTexts(res.scriptDoc)).toEqual(['circulated']);
    expect(rec.txUpdates).toHaveLength(1);
    expect(taggedTexts(rec.txUpdates[0]?.['scriptDoc'] as TiptapDoc)).toEqual(['circulated']);
  });

  it('drops a component that is no longer assigned for this role/year', async () => {
    const res = (await run(
      callerRequest({
        observationId: OBS_ID,
        suggestions: [{ paragraphIndex: 0, text: 'turned and talked', componentId: '4e' }],
      }),
    )) as ApplyResult;

    expect(res.appliedCount).toBe(0);
    expect(res.rejectedCount).toBe(1);
    expect(rec.txUpdates).toHaveLength(0);
  });

  it('drops a paragraph index that no longer exists after an edit', async () => {
    install({
      observation: observation(),
      observationInTransaction: observation({
        scriptDoc: scriptDoc('Students turned and talked.'),
      }),
    });

    const res = (await run(
      callerRequest({
        observationId: OBS_ID,
        suggestions: [{ paragraphIndex: 1, text: 'circulated', componentId: '2b' }],
      }),
    )) as ApplyResult;

    expect(res.appliedCount).toBe(0);
    expect(res.rejectedCount).toBe(1);
    expect(rec.txUpdates).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Mid-review races — the pre-transaction read is a courtesy check only, so
// every invariant has to be re-established from inside the transaction.
// ---------------------------------------------------------------------------

describe('applyScriptTags — invariants re-established inside the transaction', () => {
  const SUGGESTIONS = [
    { paragraphIndex: 0, text: 'turned and talked', componentId: '1a' },
    { paragraphIndex: 1, text: 'circulated', componentId: '2b' },
  ];

  it('refuses to write when the observation is finalized between suggest and apply', async () => {
    // Draft when the review dialog opened; finalized by the time Apply landed
    // (the observer in another tab, or an admin). A finalized observation has
    // an issued PDF and an emailed record — no AI-driven edit may touch it.
    install({
      observation: observation(),
      observationInTransaction: observation({ status: OBSERVATION_STATUS.finalized }),
    });

    await expect(
      run(callerRequest({ observationId: OBS_ID, suggestions: SUGGESTIONS })),
    ).rejects.toThrow(/finalized/);
    expect(rec.txUpdates).toHaveLength(0);
  });

  it('drops a component unassigned from the role/year between suggest and apply', async () => {
    // Both components were assignable when Gemini proposed them; an admin
    // pulled 1a off this role/year before Apply ran.
    install({
      observation: observation(),
      assignedComponentIds: ['1a', '2b'],
      assignedComponentIdsInTransaction: ['2b'],
    });

    const res = (await run(
      callerRequest({ observationId: OBS_ID, suggestions: SUGGESTIONS }),
    )) as ApplyResult;

    expect(res.appliedCount).toBe(1);
    expect(res.rejectedCount).toBe(1);
    expect(taggedTexts(res.scriptDoc)).toEqual(['circulated']);
    expect(rec.txUpdates).toHaveLength(1);
    expect(taggedTexts(rec.txUpdates[0]?.['scriptDoc'] as TiptapDoc)).toEqual(['circulated']);
  });

  it('writes nothing when every component was unassigned mid-review', async () => {
    install({
      observation: observation(),
      assignedComponentIds: ['1a', '2b'],
      assignedComponentIdsInTransaction: ['2b'],
    });

    const res = (await run(
      callerRequest({
        observationId: OBS_ID,
        suggestions: [{ paragraphIndex: 0, text: 'turned and talked', componentId: '1a' }],
      }),
    )) as ApplyResult;

    expect(res.appliedCount).toBe(0);
    expect(res.rejectedCount).toBe(1);
    expect(rec.txUpdates).toHaveLength(0);
  });

  it('aborts when the observation is deleted between suggest and apply', async () => {
    install({ observation: observation(), observationInTransaction: null });

    await expect(
      run(callerRequest({ observationId: OBS_ID, suggestions: SUGGESTIONS })),
    ).rejects.toThrow(/not found/i);
    expect(rec.txUpdates).toHaveLength(0);
  });
});
