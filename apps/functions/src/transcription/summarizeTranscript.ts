import { HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import {
  APP_SETTINGS_DOC_ID,
  COLLECTIONS,
  OBSERVATION_STATUS,
  canEditObservationContent,
  canUseGeminiFeature,
  normalizeTranscriptFocus,
  parseTranscriptSummaryMode,
  resolveGeminiFeature,
  type Observation,
  type RubricComponent,
  type TranscriptEvidence,
  type TranscriptSummary,
  type TranscriptSummaryMode,
  type TranscriptSummarySection,
} from '@ops/shared';
import { assertDemoEditTarget, onCall } from '../lib/callable.js';
import { callerObservationAccess } from '../lib/observationAccess.js';
import { ANTHROPIC_API_KEY, generateTextResult, loadFeatureModel } from '../lib/aiClient.js';
import { RATE_LIMIT_KEYS, checkRateLimit, rateLimitsFromSettings } from '../lib/rateLimit.js';
import { directReader, resolveActiveComponents } from '../observations/scriptTagging.js';

if (getApps().length === 0) initializeApp();

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Condense a finished transcript for "Send to script": evidence for the
 * observation's assigned components, or a summary around the observer's own
 * focus. Writes nothing; the editor appends the result to the script through
 * its normal autosave, the same way the full transcript is inserted.
 *
 * Runs on the text transcript already stored on the observation, so it can
 * use any text model (Claude included) and never re-reads the audio.
 */
export const summarizeTranscript = onCall(
  {
    // Demo-edit sessions allowed; confined to demo staff below.
    allowDemoEdit: true,
    region: 'us-central1',
    memory: '512MiB',
    // A full class period's transcript is long; give the model room.
    timeoutSeconds: 300,
    maxInstances: 10,
    // Needed only when an admin routes this feature to a Claude model.
    secrets: [ANTHROPIC_API_KEY],
  },
  async (request): Promise<TranscriptSummary> => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required');
    const userEmail = request.auth.token.email?.toLowerCase();
    if (!userEmail) throw new HttpsError('unauthenticated', 'Token has no email');

    const data = (request.data ?? {}) as Record<string, unknown>;
    const observationId = typeof data['observationId'] === 'string' ? data['observationId'] : '';
    const audioFileId = typeof data['audioFileId'] === 'string' ? data['audioFileId'] : '';
    const mode = parseTranscriptSummaryMode(data['mode']);
    if (!observationId || !audioFileId || !mode) {
      throw new HttpsError('invalid-argument', 'observationId, audioFileId and mode required');
    }
    const focus = mode === 'custom' ? normalizeTranscriptFocus(data['focus']) : null;
    if (mode === 'custom' && !focus) {
      throw new HttpsError('invalid-argument', 'Type what to look for first.');
    }

    const db = getFirestore();
    const settingsSnap = await db.doc(`${COLLECTIONS.appSettings}/${APP_SETTINGS_DOC_ID}`).get();
    const settings = settingsSnap.exists
      ? (settingsSnap.data() as { gemini?: { transcriptSummary?: unknown }; rateLimits?: unknown })
      : null;
    if (
      !canUseGeminiFeature(resolveGeminiFeature(settings?.gemini?.transcriptSummary), userEmail)
    ) {
      throw new HttpsError(
        'failed-precondition',
        'Transcript summaries are not available for your account.',
      );
    }

    const obsSnap = await db.doc(`${COLLECTIONS.observations}/${observationId}`).get();
    if (!obsSnap.exists) throw new HttpsError('not-found', 'Observation not found');
    const obs = obsSnap.data() as unknown as Observation;
    await assertDemoEditTarget(db, request.auth, obs.observedEmail);
    const access = await callerObservationAccess(db, obs, {
      email: userEmail,
      tokenRole: request.auth.token['role'] as string | undefined,
      auth: request.auth,
    });
    if (!canEditObservationContent(access)) {
      throw new HttpsError('permission-denied', 'Only the observers can add to the script.');
    }
    if (obs.status !== OBSERVATION_STATUS.draft) {
      throw new HttpsError(
        'failed-precondition',
        'This observation is finalized. Reopen it before adding to the script.',
      );
    }
    const stored = obs.transcripts[audioFileId];
    if (typeof stored !== 'string' || !stored.trim()) {
      throw new HttpsError('failed-precondition', 'This recording has no transcript yet.');
    }
    const transcript = redactTeacherName(stored, obs.observedName);

    const limits = rateLimitsFromSettings(settings?.rateLimits);
    const decision = await checkRateLimit(db, {
      userEmail,
      key: RATE_LIMIT_KEYS.transcriptSummary,
      max: limits.transcriptionRequestsPerDay,
      windowMs: DAY_MS,
    });
    if (!decision.allowed) {
      throw new HttpsError(
        'resource-exhausted',
        `Daily limit reached (${String(limits.transcriptionRequestsPerDay)}/day). Try again tomorrow.`,
      );
    }

    const { activeComponents, componentColorMap } = await resolveActiveComponents(
      db,
      directReader,
      obs,
      'assigned',
    );

    const model = await loadFeatureModel(db, 'transcriptSummary');
    const { text, truncated } = await generateTextResult(
      model,
      {
        prompt: buildSummaryPrompt({ mode, focus, components: activeComponents, transcript }),
        jsonSchema: SUMMARY_SCHEMA,
        temperature: 0.2,
      },
      {
        feature: 'transcriptSummary',
        logContext: 'summarizeTranscript',
        userEmail,
        observationId,
      },
    );
    if (truncated) {
      throw new HttpsError(
        'internal',
        'The AI model ran out of room before finishing. Try again, or send the full transcript.',
      );
    }
    const parsed = parseSummaryResponse(
      text,
      new Map(activeComponents.map((c) => [c.id, c.title])),
    );
    if (!parsed) {
      logger.error('summarizeTranscript: unreadable model answer', {
        model: model.id,
        raw: text.slice(0, 500),
      });
      throw new HttpsError('internal', 'The AI model returned an answer that could not be read.');
    }

    const usedIds = new Set(parsed.sections.flatMap((s) => (s.componentId ? [s.componentId] : [])));
    const components = activeComponents
      .filter((c) => usedIds.has(c.id))
      .map((c) => {
        const color = componentColorMap.get(c.id);
        return { componentId: c.id, title: c.title, bg: color?.bg ?? '', fg: color?.fg ?? '' };
      });

    logger.info('summarizeTranscript: done', {
      observationId,
      mode,
      model: model.id,
      sections: parsed.sections.length,
    });
    return { mode, focus, ...parsed, components };
  },
);

// ─── Prompt ──────────────────────────────────────────────────────────────────

const SUMMARY_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    sections: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          componentId: { type: 'string' },
          heading: { type: 'string' },
          noticed: { type: 'string' },
          evidence: {
            type: 'array',
            items: {
              type: 'object',
              properties: { time: { type: 'string' }, text: { type: 'string' } },
              required: ['time', 'text'],
              additionalProperties: false,
            },
          },
        },
        required: ['componentId', 'heading', 'noticed', 'evidence'],
        additionalProperties: false,
      },
    },
    reflectionQuestions: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'sections', 'reflectionQuestions'],
  additionalProperties: false,
};

interface PromptInput {
  mode: TranscriptSummaryMode;
  focus: string | null;
  components: readonly RubricComponent[];
  transcript: string;
}

/** Build the summary prompt. Exported for tests. */
export function buildSummaryPrompt({ mode, focus, components, transcript }: PromptInput): string {
  const componentBlock = components.map((c) => ({
    id: c.id,
    title: c.title,
    proficiencyDescriptors: c.proficiencyLevels,
    lookFors: c.lookFors.map((lf) => lf.text),
  }));

  const task =
    mode === 'domains'
      ? `Write one section per component listed below, in the order listed. Each section's "componentId" is that component's id and its "heading" is the component's title. "noticed" is one or two sentences on what an observer would notice about that component. "evidence" lists the moments in the transcript that show it.
If the transcript has no real evidence for a component, still write its section: say so in "noticed" and leave "evidence" empty.`
      : `The observer wants to know: "${focus ?? ''}"
Answer that question with sections. Group the evidence into two to five sections that make sense for the question. When a section's evidence clearly shows one of the components listed below, set "componentId" to that component's id; otherwise set it to an empty string. "heading" is a short title for the section, "noticed" one or two sentences answering the question for that part, and "evidence" the moments in the transcript that show it.`;

  return `You are helping a peer evaluator turn a classroom audio transcript into concise evidence for a teacher observation, using the Danielson Framework rubric components below. The full transcript is long and hard to read along with; your job is to make it shorter and focused, not to rate the teacher.

TASK:
${task}

RULES:
- "summary" is a short overview of the lesson (two to four sentences): what was taught and how the lesson moved.
- Each evidence item is one moment: "time" is the timestamp of that moment exactly as written in the transcript (e.g. "04:53"), or an empty string if the transcript has none. "text" is one sentence describing what happened, and may quote short phrases of what was said.
- Only use what is in the transcript. Do not invent events, quotes or timestamps.
- Never use anyone's name. Say "the teacher" and "a student" or "students", even if names are spoken in the recording.
- Keep it concise: at most five evidence items per section, the clearest ones.
- "reflectionQuestions" are two or three open questions the evaluator could ask the teacher in a coaching conversation${mode === 'domains' ? ', each starting with the component id it relates to (e.g. "2b: ...")' : ''}.
- Write in plain, professional language for educators.

COMPONENTS:
${JSON.stringify(componentBlock, null, 2)}

TRANSCRIPT:
${transcript}`;
}

// ─── Parsing ─────────────────────────────────────────────────────────────────

/**
 * Read the model's JSON into a summary. Sections pointing at a component
 * that isn't in `componentTitles` keep their content but lose the tag;
 * component sections get the rubric's own title. Null when unreadable.
 * Exported for tests.
 */
export function parseSummaryResponse(
  raw: string,
  componentTitles: ReadonlyMap<string, string>,
): Pick<TranscriptSummary, 'summary' | 'sections' | 'reflectionQuestions'> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;

  const sections: TranscriptSummarySection[] = [];
  for (const s of Array.isArray(obj['sections']) ? obj['sections'] : []) {
    if (!s || typeof s !== 'object') continue;
    const sec = s as Record<string, unknown>;
    const rawId = str(sec['componentId']);
    const componentId = rawId && componentTitles.has(rawId) ? rawId : null;
    const heading = (componentId ? componentTitles.get(componentId) : null) ?? str(sec['heading']);
    const evidence: TranscriptEvidence[] = [];
    for (const e of Array.isArray(sec['evidence']) ? sec['evidence'] : []) {
      if (!e || typeof e !== 'object') continue;
      const text = str((e as Record<string, unknown>)['text']);
      if (!text) continue;
      evidence.push({ time: normalizeTime((e as Record<string, unknown>)['time']), text });
    }
    const noticed = str(sec['noticed']);
    if (!heading && !noticed && evidence.length === 0) continue;
    sections.push({ componentId, heading, noticed, evidence });
  }

  const summary = str(obj['summary']);
  if (!summary && sections.length === 0) return null;
  const reflectionQuestions = (
    Array.isArray(obj['reflectionQuestions']) ? obj['reflectionQuestions'] : []
  )
    .map(str)
    .filter((q) => q.length > 0);
  return { summary, sections, reflectionQuestions };
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** "4:53", "[04:53]" or "1:02:05" → "04:53" / "1:02:05"; anything else → null. */
function normalizeTime(value: unknown): string | null {
  const t = str(value).replace(/^\[|\]$/g, '');
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{2})$/.exec(t);
  if (!m) return null;
  const [, h, mm = '', ss = ''] = m;
  return h ? `${h}:${mm.padStart(2, '0')}:${ss}` : `${mm.padStart(2, '0')}:${ss}`;
}

/**
 * Transcripts made before names were dropped label the teacher's turns with
 * their name. Put "Teacher" back before the text goes to the model, so the
 * name doesn't reach it or the summary. Exported for tests.
 */
export function redactTeacherName(transcript: string, observedName: string | undefined): string {
  const name = observedName?.trim();
  if (!name) return transcript;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return transcript
    .replace(new RegExp(`^((?:\\[[\\d:]+\\] )?)${escaped}:`, 'gm'), '$1Teacher:')
    .replace(new RegExp(escaped, 'gi'), 'the teacher');
}
