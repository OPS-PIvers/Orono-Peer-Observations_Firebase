import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { CallableRequest } from 'firebase-functions/v2/https';
import {
  APP_SETTINGS_DOC_ID,
  COLLECTIONS,
  OBSERVATION_STATUS,
  OBSERVATION_SUBCOLLECTIONS,
  roleYearMappingDocId,
  type TiptapDoc,
} from '@ops/shared';

process.env['FIREBASE_CONFIG'] = JSON.stringify({ projectId: 'test' });
process.env['GCLOUD_PROJECT'] = 'test';

type GenerateText = (...args: unknown[]) => Promise<string>;

interface HState {
  db: unknown;
  generateText: Mock<GenerateText>;
}

const h = vi.hoisted((): HState => ({ db: undefined, generateText: vi.fn<GenerateText>() }));

vi.mock('firebase-admin/app', () => ({ getApps: () => [{}], initializeApp: vi.fn() }));

vi.mock('firebase-admin/firestore', () => {
  class Timestamp {
    constructor(private readonly ms: number) {}
    static fromMillis(ms: number) {
      return new Timestamp(ms);
    }
    toMillis() {
      return this.ms;
    }
  }
  return {
    getFirestore: () => h.db,
    FieldValue: { serverTimestamp: () => '__server_ts__' },
    Timestamp,
  };
});

vi.mock('../lib/aiClient.js', () => ({
  ANTHROPIC_API_KEY: { name: 'ANTHROPIC_API_KEY' },
  loadFeatureModel: () => Promise.resolve({ id: 'gemini-test' }),
  generateText: (...args: unknown[]) => h.generateText(...args),
}));

const { suggestScriptTags } = await import('./suggestScriptTags.js');

const run = (req: Partial<CallableRequest>) =>
  (suggestScriptTags as unknown as { run: (r: unknown) => Promise<unknown> }).run(req);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const OBSERVER = 'observer@orono.k12.mn.us';
const OBS_ID = 'obs-1';
const OBS_PATH = `${COLLECTIONS.observations}/${OBS_ID}`;
const RUN_PATH = `${OBS_PATH}/${OBSERVATION_SUBCOLLECTIONS.scriptAutoTagRuns}/latest`;
const SETTINGS_PATH = `${COLLECTIONS.appSettings}/${APP_SETTINGS_DOC_ID}`;
const LIMIT_PATH = `rateLimitCounters/${OBSERVER}__scriptAutoTag`;

function scriptDoc(...paragraphs: string[]): TiptapDoc {
  return {
    type: 'doc',
    content: paragraphs.map((text) => ({
      type: 'paragraph',
      content: [{ type: 'text', text }],
    })),
  } as unknown as TiptapDoc;
}

function observation(over: Record<string, unknown> = {}) {
  return {
    status: OBSERVATION_STATUS.draft,
    observerEmail: OBSERVER,
    observedRole: 'teacher',
    observedYear: 1,
    scriptDoc: scriptDoc('Students turned and talked.', 'The teacher circulated.'),
    ...over,
  };
}

interface FakeDocRef {
  path: string;
  get: () => Promise<unknown>;
  set: (data: Record<string, unknown>, opts?: { merge?: boolean }) => Promise<void>;
}

/** In-memory Firestore covering the reads auto-tag makes and the run doc it writes. */
function buildDb(
  obs: Record<string, unknown>,
  savedRun?: Record<string, unknown>,
  controls?: Record<string, unknown>,
) {
  const docs = new Map<string, Record<string, unknown>>([
    [OBS_PATH, obs],
    [
      `${COLLECTIONS.appSettings}/${APP_SETTINGS_DOC_ID}`,
      { gemini: { scriptAutoTag: { access: 'all' } }, scriptAutoTagControls: controls },
    ],
    [
      `${COLLECTIONS.roleYearMappings}/${roleYearMappingDocId('teacher', 1)}`,
      { roleId: 'teacher', year: 1, assignedComponentIds: ['1a', '2b'] },
    ],
    [
      `${COLLECTIONS.rubrics}/rubric-1`,
      {
        rubricId: 'rubric-1',
        domains: [
          {
            id: 'd1',
            components: [
              {
                id: '1a',
                title: 'Knowledge of Content',
                color: { bg: '#dbeafe', fg: '#1e3a8a' },
                lookFors: [],
              },
              {
                id: '2b',
                title: 'Culture for Learning',
                color: { bg: '#dcfce7', fg: '#14532d' },
                lookFors: [],
              },
              {
                id: '3c',
                title: 'Engaging Students',
                color: { bg: '#fef3c7', fg: '#78350f' },
                lookFors: [],
              },
            ],
          },
        ],
      },
    ],
  ]);
  if (savedRun) docs.set(RUN_PATH, savedRun);

  function snapshot(path: string) {
    const data = docs.get(path);
    return { exists: data !== undefined, id: path.split('/').pop() ?? '', data: () => data };
  }

  function write(path: string, data: Record<string, unknown>, opts?: { merge?: boolean }) {
    docs.set(path, opts?.merge ? { ...(docs.get(path) ?? {}), ...data } : data);
  }

  function doc(path: string): FakeDocRef {
    return {
      path,
      get: () => Promise.resolve(snapshot(path)),
      set: (data, opts) => {
        write(path, data, opts);
        return Promise.resolve();
      },
    };
  }

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
      doc(id: string) {
        return doc(`${name}/${id}`);
      },
      get() {
        let rows: Record<string, unknown>[] =
          name === COLLECTIONS.roles
            ? [{ id: 'r1', roleId: 'teacher', displayName: 'Teacher', rubricId: 'rubric-1' }]
            : [];
        for (const [f, v] of filters) rows = rows.filter((r) => r[f] === v);
        const rowDocs = rows.map((r) => ({ id: 'doc', data: () => r }));
        return Promise.resolve({ empty: rowDocs.length === 0, docs: rowDocs });
      },
    };
    return q;
  }

  function runTransaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
    return fn({
      get: (ref: FakeDocRef) => Promise.resolve(snapshot(ref.path)),
      set: (ref: FakeDocRef, data: Record<string, unknown>, opts?: { merge?: boolean }) => {
        write(ref.path, data, opts);
      },
    });
  }

  return { db: { doc, collection, runTransaction }, docs };
}

function callerRequest(data: Record<string, unknown>): Partial<CallableRequest> {
  return {
    auth: { uid: 'uid-1', token: { email: OBSERVER } },
    data,
  } as unknown as Partial<CallableRequest>;
}

interface SuggestResult {
  suggestions: {
    text: string;
    componentId: string;
    status: string;
    confidence: string | null;
    rationale: string;
  }[];
  run: {
    reused: boolean;
    runCount: number;
    reason: string | null;
    scope: string;
    options: { components: string; detail: string; rationale: boolean };
  };
}

const MODEL_REPLY = JSON.stringify({
  tags: [
    {
      paragraphIndex: 0,
      text: 'turned and talked',
      componentId: '2b',
      confidence: 'high',
      rationale: 'Students talk with each other about the work.',
    },
    {
      paragraphIndex: 1,
      text: 'circulated',
      componentId: '1a',
      confidence: 'sure',
      rationale: 'Teacher monitors.',
    },
  ],
});

let docs: Map<string, Record<string, unknown>>;

function install(
  obs = observation(),
  savedRun?: Record<string, unknown>,
  controls?: Record<string, unknown>,
) {
  const built = buildDb(obs, savedRun, controls);
  h.db = built.db;
  docs = built.docs;
}

beforeEach(() => {
  h.generateText = vi.fn<GenerateText>(() => Promise.resolve(MODEL_REPLY));
  install();
});

function savedRun(over: Record<string, unknown> = {}) {
  return {
    scope: 'assigned',
    options: { components: 'assigned', detail: 'balanced', rationale: true },
    suggestions: [
      {
        paragraphIndex: 0,
        text: 'turned and talked',
        componentId: '2b',
        componentTitle: 'Culture for Learning',
        paragraphText: 'Students turned and talked.',
        status: 'applied',
      },
      {
        paragraphIndex: 1,
        text: 'circulated',
        componentId: '1a',
        componentTitle: 'Knowledge of Content',
        paragraphText: 'The teacher circulated.',
        status: 'dismissed',
      },
    ],
    componentColors: [],
    skippedCount: 0,
    createdAt: new Date('2026-10-14T12:00:00Z'),
    createdBy: OBSERVER,
    modelId: 'gemini-test',
    runCount: 1,
    reason: null,
    inFlight: null,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('suggestScriptTags — one AI run per observation', () => {
  it('calls the model on the first run and saves the result', async () => {
    const res = (await run(callerRequest({ observationId: OBS_ID }))) as SuggestResult;

    expect(h.generateText).toHaveBeenCalledTimes(1);
    expect(res.run).toMatchObject({ reused: false, runCount: 1, reason: null });
    expect(res.suggestions.map((s) => s.status)).toEqual(['pending', 'pending']);
    const saved = docs.get(RUN_PATH);
    expect(saved?.['suggestions']).toHaveLength(2);
    expect(saved?.['inFlight']).toBeNull();
  });

  it('returns the saved run on a second call without calling the model', async () => {
    install(observation(), savedRun());
    const res = (await run(callerRequest({ observationId: OBS_ID }))) as SuggestResult;

    expect(h.generateText).not.toHaveBeenCalled();
    expect(res.run.reused).toBe(true);
    expect(res.suggestions.map((s) => s.status)).toEqual(['applied', 'dismissed']);
  });

  it('reopens under the saved scope, not the toggle the caller sent', async () => {
    install(observation(), savedRun({ scope: 'full' }));
    const res = (await run(
      callerRequest({ observationId: OBS_ID, scope: 'assigned' }),
    )) as SuggestResult;
    expect(res.run.scope).toBe('full');
  });

  it('flags saved suggestions the script no longer contains as stale', async () => {
    install(
      observation({ scriptDoc: scriptDoc('Students turned and talked.', 'Rewritten.') }),
      savedRun({
        suggestions: savedRun().suggestions.map((s) => ({ ...s, status: 'pending' })),
      }),
    );
    const res = (await run(callerRequest({ observationId: OBS_ID }))) as SuggestResult;
    expect(res.suggestions.map((s) => s.status)).toEqual(['pending', 'stale']);
  });

  it('re-runs when given a reason, and passes the reason and past decisions to the model', async () => {
    install(observation(), savedRun());
    const res = (await run(
      callerRequest({ observationId: OBS_ID, reason: 'Added the exit-ticket discussion.' }),
    )) as SuggestResult;

    expect(h.generateText).toHaveBeenCalledTimes(1);
    const prompt = (h.generateText.mock.calls[0]?.[1] as { prompt: string }).prompt;
    expect(prompt).toContain('Added the exit-ticket discussion.');
    expect(prompt).toContain('Rejected by the observer last time');
    expect(res.run).toMatchObject({
      reused: false,
      runCount: 2,
      reason: 'Added the exit-ticket discussion.',
    });
  });

  it.each([
    ['too short', 'again'],
    ['blank', '      '],
    ['not a string', 42],
  ])('rejects a re-run reason that is %s', async (_label, reason) => {
    install(observation(), savedRun());
    await expect(run(callerRequest({ observationId: OBS_ID, reason }))).rejects.toThrow(
      /reason|characters/,
    );
    expect(h.generateText).not.toHaveBeenCalled();
  });

  it('refuses to start while another run is in flight', async () => {
    install(observation(), savedRun({ inFlight: { by: OBSERVER, startedAtMs: Date.now() } }));
    await expect(
      run(callerRequest({ observationId: OBS_ID, reason: 'Added the exit-ticket discussion.' })),
    ).rejects.toThrow(/already running/);
    expect(h.generateText).not.toHaveBeenCalled();
  });

  it('blocks a double click on the first run', async () => {
    install(observation(), { inFlight: { by: OBSERVER, startedAtMs: Date.now() } });
    await expect(run(callerRequest({ observationId: OBS_ID }))).rejects.toThrow(/already running/);
    expect(h.generateText).not.toHaveBeenCalled();
  });

  it('ignores a claim old enough to have been abandoned', async () => {
    install(observation(), { inFlight: { by: OBSERVER, startedAtMs: Date.now() - 10 * 60_000 } });
    await run(callerRequest({ observationId: OBS_ID }));
    expect(h.generateText).toHaveBeenCalledTimes(1);
  });

  it('releases the claim and keeps the old result when the model call fails', async () => {
    install(observation(), savedRun());
    h.generateText = vi.fn<GenerateText>(() => Promise.reject(new Error('model down')));
    await expect(
      run(callerRequest({ observationId: OBS_ID, reason: 'Added the exit-ticket discussion.' })),
    ).rejects.toThrow(/model down/);

    const saved = docs.get(RUN_PATH);
    expect(saved?.['inFlight']).toBeNull();
    expect(saved?.['runCount']).toBe(1);
    expect(saved?.['suggestions']).toHaveLength(2);
  });

  it('still checks access before reopening a saved run', async () => {
    install(observation({ status: OBSERVATION_STATUS.finalized }), savedRun());
    await expect(run(callerRequest({ observationId: OBS_ID }))).rejects.toThrow(/finalized/);
  });
});

describe('suggestScriptTags — run options', () => {
  const promptOf = () => (h.generateText.mock.calls[0]?.[1] as { prompt: string }).prompt;

  it('returns confidence and a reason with each suggestion by default', async () => {
    const res = (await run(callerRequest({ observationId: OBS_ID }))) as SuggestResult;
    expect(res.suggestions.map((s) => s.confidence)).toEqual(['high', 'medium']);
    expect(res.suggestions[0]?.rationale).toBe('Students talk with each other about the work.');
    expect(res.run.options).toEqual({
      components: 'assigned',
      detail: 'balanced',
      rationale: true,
    });
    expect(promptOf()).toContain('one short sentence');
  });

  it('drops reasons when the observer turned them off', async () => {
    const res = (await run(
      callerRequest({ observationId: OBS_ID, options: { rationale: false } }),
    )) as SuggestResult;
    expect(res.suggestions.every((s) => s.rationale === '')).toBe(true);
    expect(promptOf()).toContain('"rationale" must be an empty string');
  });

  it('sends the whole rubric with assigned components marked for "prefer assigned"', async () => {
    const res = (await run(
      callerRequest({ observationId: OBS_ID, options: { components: 'preferAssigned' } }),
    )) as SuggestResult;
    expect(res.run.scope).toBe('full');
    const prompt = promptOf();
    expect(prompt).toContain('"id": "3c"');
    expect(prompt).toContain('"assigned": false');
    expect(prompt).toContain('use the assigned one');
  });

  it('leaves out unassigned components for "assigned only"', async () => {
    await run(callerRequest({ observationId: OBS_ID, options: { components: 'assigned' } }));
    expect(promptOf()).not.toContain('"id": "3c"');
    expect(promptOf()).not.toContain('"assigned"');
  });

  it('weighs the whole rubric equally for "full"', async () => {
    const res = (await run(
      callerRequest({ observationId: OBS_ID, options: { components: 'full' } }),
    )) as SuggestResult;
    expect(res.run.scope).toBe('full');
    expect(promptOf()).toContain('"id": "3c"');
    expect(promptOf()).not.toContain('"assigned"');
  });

  it('still honours the older scope field when no options are sent', async () => {
    const res = (await run(
      callerRequest({ observationId: OBS_ID, scope: 'full' }),
    )) as SuggestResult;
    expect(res.run.options.components).toBe('full');
  });

  it('changes the tagging rule with the detail level', async () => {
    await run(callerRequest({ observationId: OBS_ID, options: { detail: 'key' } }));
    expect(promptOf()).toContain('strongest, most clearly demonstrated evidence');
  });

  it('reopens a saved run with the options it was made with', async () => {
    install(
      observation(),
      savedRun({ scope: 'full', options: { components: 'full', detail: 'key', rationale: false } }),
    );
    const res = (await run(
      callerRequest({ observationId: OBS_ID, options: { components: 'assigned' } }),
    )) as SuggestResult;
    expect(res.run.options).toEqual({ components: 'full', detail: 'key', rationale: false });
  });
});

describe('suggestScriptTags — admin controls', () => {
  const promptOf = () => (h.generateText.mock.calls[0]?.[1] as { prompt: string }).prompt;
  const schemaOf = () =>
    JSON.stringify((h.generateText.mock.calls[0]?.[1] as { jsonSchema: unknown }).jsonSchema);

  it('refuses a re-run when the admin turned re-runs off', async () => {
    install(observation(), savedRun(), { rerun: false });
    await expect(
      run(callerRequest({ observationId: OBS_ID, reason: 'Added the exit-ticket discussion.' })),
    ).rejects.toThrow(/turned off/);
    expect(h.generateText).not.toHaveBeenCalled();
  });

  it('still reopens the saved run when re-runs are off', async () => {
    install(observation(), savedRun(), { rerun: false });
    const res = (await run(callerRequest({ observationId: OBS_ID }))) as SuggestResult;
    expect(res.run.reused).toBe(true);
  });

  it('moves a turned-off choice to the nearest allowed one', async () => {
    install(observation(), undefined, {
      components: { full: false },
      detail: { thorough: false },
      rationale: false,
    });
    const res = (await run(
      callerRequest({
        observationId: OBS_ID,
        options: { components: 'full', detail: 'thorough', rationale: true },
      }),
    )) as SuggestResult;
    expect(res.run.options).toEqual({
      components: 'preferAssigned',
      detail: 'balanced',
      rationale: false,
    });
    expect(res.suggestions.every((s) => s.rationale === '')).toBe(true);
  });

  it('leaves confidence out of the prompt and the results when turned off', async () => {
    install(observation(), undefined, { confidence: false });
    const res = (await run(callerRequest({ observationId: OBS_ID }))) as SuggestResult;
    expect(promptOf()).not.toContain('"confidence"');
    expect(schemaOf()).not.toContain('confidence');
    expect(res.suggestions.every((s) => s.confidence === null)).toBe(true);
  });
});

describe('suggestScriptTags — per-user hourly limit', () => {
  const REASON = 'Added the exit-ticket discussion.';

  function setLimit(max: number) {
    docs.set(SETTINGS_PATH, {
      ...(docs.get(SETTINGS_PATH) ?? {}),
      rateLimits: { scriptAutoTagRunsPerHour: max },
    });
  }

  it('counts first runs and reruns, and refuses once the hour is used up', async () => {
    install(observation(), savedRun());
    setLimit(2);

    await run(callerRequest({ observationId: OBS_ID, reason: REASON }));
    await run(callerRequest({ observationId: OBS_ID, reason: 'Second pass after more notes.' }));
    expect(h.generateText).toHaveBeenCalledTimes(2);
    expect(docs.get(LIMIT_PATH)?.['count']).toBe(2);

    await expect(
      run(callerRequest({ observationId: OBS_ID, reason: 'A third try with any reason at all.' })),
    ).rejects.toMatchObject({ code: 'resource-exhausted' });
    expect(h.generateText).toHaveBeenCalledTimes(2);
    expect(docs.get(LIMIT_PATH)?.['count']).toBe(2);
    // The refused call made no claim, so the observation isn't left locked.
    expect(docs.get(RUN_PATH)?.['inFlight']).toBeNull();
  });

  it('shares one quota across observations', async () => {
    setLimit(1);
    await run(callerRequest({ observationId: OBS_ID }));
    expect(h.generateText).toHaveBeenCalledTimes(1);

    // A different draft the same observer owns.
    docs.set(`${COLLECTIONS.observations}/obs-2`, observation());
    await expect(run(callerRequest({ observationId: 'obs-2' }))).rejects.toMatchObject({
      code: 'resource-exhausted',
    });
    expect(h.generateText).toHaveBeenCalledTimes(1);
  });

  it('does not charge the quota for reopening a saved run', async () => {
    install(observation(), savedRun());
    setLimit(1);
    await run(callerRequest({ observationId: OBS_ID }));
    await run(callerRequest({ observationId: OBS_ID }));
    expect(docs.has(LIMIT_PATH)).toBe(false);
  });

  it('does not charge the quota when the claim is refused', async () => {
    install(observation(), savedRun({ inFlight: { by: OBSERVER, startedAtMs: Date.now() } }));
    await expect(run(callerRequest({ observationId: OBS_ID, reason: REASON }))).rejects.toThrow(
      /already running/,
    );
    expect(docs.has(LIMIT_PATH)).toBe(false);
  });

  it('starts a fresh window once the hour has passed', async () => {
    setLimit(1);
    const { Timestamp } = await import('firebase-admin/firestore');
    docs.set(LIMIT_PATH, {
      count: 1,
      windowStart: Timestamp.fromMillis(Date.now() - 61 * 60_000),
    });
    await run(callerRequest({ observationId: OBS_ID }));
    expect(h.generateText).toHaveBeenCalledTimes(1);
    expect(docs.get(LIMIT_PATH)?.['count']).toBe(1);
  });
});
