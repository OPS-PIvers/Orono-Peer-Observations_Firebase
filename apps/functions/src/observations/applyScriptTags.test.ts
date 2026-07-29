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
   * object; set it to model the observer editing the script mid-review.
   */
  observationInTransaction?: Record<string, unknown> | null;
  settings?: Record<string, unknown>;
}

interface Recorder {
  txUpdates: Record<string, unknown>[];
}

function buildDb(config: DbConfig): { db: unknown; rec: Recorder } {
  const rec: Recorder = { txUpdates: [] };
  const obsPath = `${COLLECTIONS.observations}/${OBS_ID}`;
  const txDoc =
    config.observationInTransaction === undefined
      ? config.observation
      : config.observationInTransaction;

  const obsRef = {
    get: () =>
      Promise.resolve({
        exists: config.observation !== null,
        id: OBS_ID,
        data: () => config.observation ?? undefined,
      }),
  };

  const docs: Record<string, Record<string, unknown> | undefined> = {
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
    [`${COLLECTIONS.roleYearMappings}/${roleYearMappingDocId('teacher', 1)}`]: {
      roleId: 'teacher',
      year: 1,
      assignedComponentIds: ['1a', '2b'],
    },
  };

  function collection(name: string) {
    const filters: [string, unknown][] = [];
    const q = {
      where(field: string, _op: string, val: unknown) {
        filters.push([field, val]);
        return q;
      },
      limit() {
        return q;
      },
      get: () => {
        let rows: (Record<string, unknown> & { id?: string })[] =
          name === COLLECTIONS.roles
            ? [{ id: 'r1', roleId: 'teacher', displayName: 'Teacher', rubricId: 'rubric-1' }]
            : [];
        for (const [f, v] of filters) rows = rows.filter((r) => r[f] === v);
        const rowDocs = rows.map((r) => ({ id: r.id ?? 'doc', data: () => r }));
        return Promise.resolve({ empty: rowDocs.length === 0, docs: rowDocs });
      },
    };
    return q;
  }

  function doc(path: string) {
    if (path === obsPath) return obsRef;
    return {
      get: () => {
        const data = docs[path];
        return Promise.resolve({ exists: data !== undefined, data: () => data });
      },
    };
  }

  function runTransaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
    const tx = {
      get: () =>
        Promise.resolve({
          exists: txDoc !== null,
          id: OBS_ID,
          data: () => txDoc ?? undefined,
        }),
      update: (_ref: unknown, patch: Record<string, unknown>) => {
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
