import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { CallableRequest } from 'firebase-functions/v2/https';
import {
  APP_SETTINGS_DOC_ID,
  COLLECTIONS,
  OBSERVATION_STATUS,
  roleYearMappingDocId,
  type RubricComponent,
} from '@ops/shared';

process.env['FIREBASE_CONFIG'] = JSON.stringify({ projectId: 'test' });
process.env['GCLOUD_PROJECT'] = 'test';

type GenerateTextResult = (...args: unknown[]) => Promise<{ text: string; truncated: boolean }>;

interface HState {
  db: unknown;
  generate: Mock<GenerateTextResult>;
  allowed: boolean;
  rateChecks: number;
}

const h = vi.hoisted((): HState => ({
  db: undefined,
  generate: vi.fn<GenerateTextResult>(),
  allowed: true,
  rateChecks: 0,
}));

vi.mock('firebase-admin/app', () => ({ getApps: () => [{}], initializeApp: vi.fn() }));
vi.mock('firebase-admin/firestore', () => ({ getFirestore: () => h.db }));
vi.mock('../lib/aiClient.js', () => ({
  ANTHROPIC_API_KEY: { name: 'ANTHROPIC_API_KEY' },
  loadFeatureModel: () => Promise.resolve({ id: 'gemini-test' }),
  generateTextResult: (...args: unknown[]) => h.generate(...args),
}));
vi.mock('../lib/rateLimit.js', () => ({
  RATE_LIMIT_KEYS: { transcriptSummary: 'transcriptSummary' },
  rateLimitsFromSettings: () => ({ transcriptionRequestsPerDay: 50 }),
  checkRateLimit: () => {
    h.rateChecks++;
    return Promise.resolve({ allowed: h.allowed, remaining: 0, resetAtMs: 0 });
  },
}));

const { summarizeTranscript, buildSummaryPrompt, parseSummaryResponse, redactTeacherName } =
  await import('./summarizeTranscript.js');

const run = (req: Partial<CallableRequest>) =>
  (summarizeTranscript as unknown as { run: (r: unknown) => Promise<unknown> }).run(req);

const OBSERVER = 'observer@orono.k12.mn.us';
const OBS_ID = 'obs-1';
const AUDIO_ID = 'audio-1';

const COMPONENTS = [
  {
    id: '2b',
    title: 'Culture for Learning',
    color: { bg: '#dcfce7', fg: '#14532d' },
    lookFors: [],
  },
  {
    id: '2c',
    title: 'Classroom Procedures',
    color: { bg: '#fef3c7', fg: '#78350f' },
    lookFors: [],
  },
  { id: '3c', title: 'Engaging Students', color: { bg: '#ede9fe', fg: '#4c1d95' }, lookFors: [] },
];

function observation(over: Record<string, unknown> = {}) {
  return {
    status: OBSERVATION_STATUS.draft,
    observerEmail: OBSERVER,
    observedEmail: 'teacher@orono.k12.mn.us',
    observedName: 'Jane Smith',
    observedRole: 'teacher',
    observedYear: 1,
    transcripts: {
      [AUDIO_ID]:
        '[01:12] Jane Smith: Grab your journals, Jane Smith here.\n[01:19] Student: Okay.',
    },
    ...over,
  };
}

function buildDb(obs: Record<string, unknown>, access = 'all', { rubric = true } = {}) {
  const docs = new Map<string, Record<string, unknown>>([
    [`${COLLECTIONS.observations}/${OBS_ID}`, obs],
    [
      `${COLLECTIONS.appSettings}/${APP_SETTINGS_DOC_ID}`,
      { gemini: { transcriptSummary: { access } } },
    ],
    [
      `${COLLECTIONS.roleYearMappings}/${roleYearMappingDocId('teacher', 1)}`,
      { roleId: 'teacher', year: 1, assignedComponentIds: ['2b', '2c'] },
    ],
  ]);
  if (rubric) {
    docs.set(`${COLLECTIONS.rubrics}/rubric-1`, {
      rubricId: 'rubric-1',
      domains: [{ id: 'd2', components: COMPONENTS }],
    });
  }
  const snapshot = (path: string) => {
    const data = docs.get(path);
    return { exists: data !== undefined, data: () => data };
  };
  return {
    doc: (path: string) => ({ path, get: () => Promise.resolve(snapshot(path)) }),
    collection: (name: string) => {
      const q = {
        where: () => q,
        limit: () => q,
        get: () => {
          const rows =
            name === COLLECTIONS.roles
              ? [{ roleId: 'teacher', displayName: 'Teacher', rubricId: 'rubric-1' }]
              : [];
          return Promise.resolve({
            empty: rows.length === 0,
            docs: rows.map((r) => ({ data: () => r })),
          });
        },
      };
      return q;
    },
  };
}

const request = (data: Record<string, unknown>, email = OBSERVER): Partial<CallableRequest> =>
  ({ auth: { uid: 'u', token: { email } }, data }) as unknown as Partial<CallableRequest>;

const MODEL_ANSWER = JSON.stringify({
  summary: 'A lesson on peer pressure.',
  sections: [
    {
      componentId: '2b',
      heading: 'whatever the model wrote',
      noticed: 'Sharing was voluntary.',
      evidence: [{ time: '4:53', text: 'The teacher invites students to share.' }],
    },
    {
      componentId: '9z',
      heading: 'Not a real component',
      noticed: 'Kept, but untagged.',
      evidence: [{ time: '', text: 'Something.' }],
    },
  ],
  reflectionQuestions: ['2b: What helped students share?', '  '],
});

beforeEach(() => {
  h.generate.mockReset();
  h.generate.mockResolvedValue({ text: MODEL_ANSWER, truncated: false });
  h.allowed = true;
  h.rateChecks = 0;
});

describe('summarizeTranscript', () => {
  it('returns assigned-domain evidence with component titles and colors', async () => {
    h.db = buildDb(observation());
    const result = await run(
      request({ observationId: OBS_ID, audioFileId: AUDIO_ID, mode: 'domains' }),
    );
    expect(result).toEqual({
      mode: 'domains',
      focus: null,
      summary: 'A lesson on peer pressure.',
      sections: [
        {
          componentId: '2b',
          heading: 'Culture for Learning',
          noticed: 'Sharing was voluntary.',
          evidence: [{ time: '04:53', text: 'The teacher invites students to share.' }],
        },
        {
          componentId: null,
          heading: 'Not a real component',
          noticed: 'Kept, but untagged.',
          evidence: [{ time: null, text: 'Something.' }],
        },
      ],
      reflectionQuestions: ['2b: What helped students share?'],
      components: [
        { componentId: '2b', title: 'Culture for Learning', bg: '#dcfce7', fg: '#14532d' },
      ],
    });
  });

  it('sends only the assigned components, and no teacher name, to the model', async () => {
    h.db = buildDb(observation());
    await run(request({ observationId: OBS_ID, audioFileId: AUDIO_ID, mode: 'domains' }));
    const prompt = (h.generate.mock.calls[0]?.[1] as { prompt: string }).prompt;
    expect(prompt).toContain('"id": "2b"');
    expect(prompt).toContain('"id": "2c"');
    expect(prompt).not.toContain('"id": "3c"');
    expect(prompt).not.toContain('Jane Smith');
    expect(prompt).toContain('[01:12] Teacher: Grab your journals, the teacher here.');
  });

  it('puts the custom focus in the prompt', async () => {
    h.db = buildDb(observation());
    const result = (await run(
      request({
        observationId: OBS_ID,
        audioFileId: AUDIO_ID,
        mode: 'custom',
        focus: '  How does she   give feedback? ',
      }),
    )) as { focus: string };
    expect(result.focus).toBe('How does she give feedback?');
    const prompt = (h.generate.mock.calls[0]?.[1] as { prompt: string }).prompt;
    expect(prompt).toContain('The observer wants to know: "How does she give feedback?"');
  });

  it('requires a focus for custom', async () => {
    h.db = buildDb(observation());
    await expect(
      run(request({ observationId: OBS_ID, audioFileId: AUDIO_ID, mode: 'custom', focus: ' ' })),
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('is refused when the feature is off', async () => {
    h.db = buildDb(observation(), 'off');
    await expect(
      run(request({ observationId: OBS_ID, audioFileId: AUDIO_ID, mode: 'domains' })),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(h.generate).not.toHaveBeenCalled();
  });

  it('is refused for someone who is not an observer', async () => {
    h.db = buildDb(observation());
    await expect(
      run(
        request(
          { observationId: OBS_ID, audioFileId: AUDIO_ID, mode: 'domains' },
          'teacher@orono.k12.mn.us',
        ),
      ),
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('is refused on a finalized observation', async () => {
    h.db = buildDb(observation({ status: OBSERVATION_STATUS.finalized }));
    await expect(
      run(request({ observationId: OBS_ID, audioFileId: AUDIO_ID, mode: 'domains' })),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('is refused when the recording has no transcript', async () => {
    h.db = buildDb(observation({ transcripts: {} }));
    await expect(
      run(request({ observationId: OBS_ID, audioFileId: AUDIO_ID, mode: 'domains' })),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('is refused when the observation has no transcripts at all', async () => {
    h.db = buildDb(observation({ transcripts: undefined }));
    await expect(
      run(request({ observationId: OBS_ID, audioFileId: AUDIO_ID, mode: 'domains' })),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('uses no daily quota when the rubric is missing', async () => {
    h.db = buildDb(observation(), 'all', { rubric: false });
    await expect(
      run(request({ observationId: OBS_ID, audioFileId: AUDIO_ID, mode: 'domains' })),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(h.rateChecks).toBe(0);
  });

  it('is refused past the daily limit', async () => {
    h.db = buildDb(observation());
    h.allowed = false;
    await expect(
      run(request({ observationId: OBS_ID, audioFileId: AUDIO_ID, mode: 'domains' })),
    ).rejects.toMatchObject({ code: 'resource-exhausted' });
    expect(h.generate).not.toHaveBeenCalled();
  });

  it('fails rather than returning a cut-off answer', async () => {
    h.db = buildDb(observation());
    h.generate.mockResolvedValue({ text: MODEL_ANSWER, truncated: true });
    await expect(
      run(request({ observationId: OBS_ID, audioFileId: AUDIO_ID, mode: 'domains' })),
    ).rejects.toMatchObject({ code: 'internal' });
  });
});

describe('parseSummaryResponse', () => {
  const titles = new Map([['2b', 'Culture for Learning']]);

  it('returns null for unreadable or empty answers', () => {
    expect(parseSummaryResponse('not json', titles)).toBeNull();
    expect(parseSummaryResponse('{}', titles)).toBeNull();
  });

  it('normalizes timestamps', () => {
    const parsed = parseSummaryResponse(
      JSON.stringify({
        summary: 's',
        sections: [
          {
            componentId: '',
            heading: 'h',
            noticed: 'n',
            evidence: [
              { time: '[01:19]', text: 'a' },
              { time: '1:02:05', text: 'b' },
              { time: 'early on', text: 'c' },
            ],
          },
        ],
      }),
      titles,
    );
    expect(parsed?.sections[0]?.evidence.map((e) => e.time)).toEqual(['01:19', '1:02:05', null]);
  });
});

describe('buildSummaryPrompt', () => {
  const components = COMPONENTS.slice(0, 2).map((c) => ({
    ...c,
    proficiencyLevels: { developing: '', basic: '', proficient: '', distinguished: '' },
  })) as unknown as RubricComponent[];

  it('asks for one section per component in domains mode', () => {
    const prompt = buildSummaryPrompt({
      mode: 'domains',
      focus: null,
      components,
      transcript: 'T',
    });
    expect(prompt).toContain('Write one section per component');
    expect(prompt).toContain('Never use anyone');
  });
});

describe('redactTeacherName', () => {
  it('relabels named turns and removes the name elsewhere', () => {
    expect(
      redactTeacherName('[00:01] Jane Smith: Hi.\nStudent: Hi jane smith.', ' Jane Smith '),
    ).toBe('[00:01] Teacher: Hi.\nStudent: Hi the teacher.');
  });

  it('replaces the name only as a whole word', () => {
    expect(redactTeacherName('Ann: Annual plans, ann.', 'Ann')).toBe(
      'Teacher: Annual plans, the teacher.',
    );
  });

  it('leaves the transcript alone without a name', () => {
    expect(redactTeacherName('Teacher: Hi.', '')).toBe('Teacher: Hi.');
  });
});
