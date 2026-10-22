/**
 * Speaker-labeled, timestamped transcripts. Gemini returns structured turns
 * (start time, speaker, text) and this module turns them into one line per
 * speaker turn:
 *
 *   [00:42] Teacher: Okay, take out your notebooks.
 *   [00:51] Student: Is this the one from yesterday?
 *
 * The formatted text is what lands in `transcripts[audioFileId]`, so the
 * script insert and PDF keep working on plain lines.
 */

export const TRANSCRIPTION_PROMPT = `Transcribe the attached classroom audio recording word for word, split into speaker turns.

This must be a true verbatim transcript: exactly what was said, as it was said, and nothing else.
- Keep every filler word and sound (um, uh, er, like, you know, mm-hmm).
- Write down every sound a person makes with their voice, spelled the way it sounds, as part of that person's turn: shushing ("shh"), sound effects ("vroom", "boom", "pew pew"), laughs ("haha"), gasps, groans and sighs ("ugh", "whoa", "hmm"), clicks and whistles ("tsk", "pfft").
- Keep false starts, stutters, cut-off words, repeated words and self-corrections exactly as spoken ("I- I think we, we should...").
- Keep the speaker's own wording and grammar. Do not fix grammar, finish sentences, reword, summarize, shorten or tidy anything up.
- Do not add words that were not spoken. If a word or phrase cannot be made out, write [inaudible] in its place instead of guessing.
- Do not add commentary, headings or notes, and do not describe noises that are not made by a voice (a door, chairs, a bell).
- If no one is speaking for a stretch, write nothing for it.

Start a new turn every time the speaker changes. For each turn give:
- "start": when the turn begins, as "MM:SS" (or "H:MM:SS" past one hour), measured from the start of the recording.
- "speaker": the speaker's role, never a name. Use "Teacher" for the adult leading the class, "Student" for one student, "Students" for several speaking at once, and "Other Adult" for any other adult (a co-teacher, paraprofessional or visitor). If you can reliably tell individual students apart, you may use "Student 1", "Student 2", and so on, keeping each number on the same student throughout.
- "text": the verbatim words of that turn.

Return JSON only, in this shape: {"turns": [{"start": "00:00", "speaker": "Teacher", "text": "..."}]}`;

export const TRANSCRIPT_TURNS_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    turns: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          start: { type: 'string' },
          speaker: { type: 'string' },
          text: { type: 'string' },
        },
        required: ['start', 'speaker', 'text'],
      },
    },
  },
  required: ['turns'],
};

export interface TranscriptTurn {
  /** Seconds from the start of the recording, or null when unreadable. */
  startSeconds: number | null;
  speaker: string;
  text: string;
}

/** Parse "MM:SS", "H:MM:SS", or a plain number of seconds. */
export function parseTimestamp(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/^\[|\]$/g, '');
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  const parts = trimmed.split(':');
  if (parts.length < 2 || parts.length > 3) return null;
  if (!parts.every((p) => /^\d+(\.\d+)?$/.test(p))) return null;
  return parts.map(Number).reduce((total, n) => total * 60 + n, 0);
}

/** Format seconds as [MM:SS], or [H:MM:SS] from one hour on. */
export function formatTimestamp(seconds: number): string {
  const whole = Math.floor(seconds);
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `[${h}:${mm}:${ss}]` : `[${mm}:${ss}]`;
}

function toTurn(raw: unknown): TranscriptTurn | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const text = typeof record['text'] === 'string' ? record['text'].replace(/\s+/g, ' ').trim() : '';
  if (!text) return null;
  const speaker =
    typeof record['speaker'] === 'string' && record['speaker'].trim()
      ? record['speaker'].trim()
      : 'Unknown';
  return { startSeconds: parseTimestamp(record['start']), speaker, text };
}

function turnsFrom(parsed: unknown): TranscriptTurn[] | null {
  const list = Array.isArray(parsed)
    ? parsed
    : typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)['turns']
      : undefined;
  if (!Array.isArray(list)) return null;
  return list.map(toTurn).filter((t): t is TranscriptTurn => t !== null);
}

/**
 * Fixes the two slips that break JSON.parse on a long reply: a backslash
 * before a character JSON does not escape (\' or \a), and a raw tab or
 * line break inside a string.
 */
function repairJson(text: string): string {
  return text
    .replace(/\\(\\|["/bfnrtu])|\\/g, (match, kept: string | undefined) =>
      kept === undefined ? '' : match,
    )
    .replace(/[\t\n\r\f\v]/g, ' ');
}

/**
 * Last resort for a reply that does not parse as a whole: read each flat
 * {...} object on its own and keep the ones that are turns. One bad turn
 * then costs that turn, not the whole class period. `skipped` counts the
 * objects that still could not be read, so the gap can be marked.
 */
function salvageTurns(text: string): TranscriptRead {
  const turns: TranscriptTurn[] = [];
  let skipped = 0;
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') {
      // A turn left open (no closing brace) before the next one starts is
      // lost too. The outer {"turns": [ wrapper has no "text" key.
      if (start !== -1 && text.slice(start, i).includes('"text"')) skipped++;
      start = i;
    } else if (ch === '}' && start !== -1) {
      const candidate = text.slice(start, i + 1);
      start = -1;
      let read = false;
      for (const attempt of [candidate, repairJson(candidate)]) {
        try {
          const turn = toTurn(JSON.parse(attempt));
          if (turn) turns.push(turn);
          read = true;
          break;
        } catch {
          // try the repaired text, then give up on this object
        }
      }
      if (!read) skipped++;
    }
  }
  return { turns, skipped };
}

export interface TranscriptRead {
  turns: TranscriptTurn[];
  /** Turn objects in the reply that could not be read and were left out. */
  skipped: number;
}

/**
 * Read Gemini's JSON reply. A long recording can hit the output limit and cut
 * the JSON off mid-turn; in that case keep every turn that finished. A turn
 * the model wrote as broken JSON is dropped (and counted in `skipped`) and
 * the rest are kept. Returns null when nothing usable can be read.
 */
export function readTranscriptTurns(raw: string): TranscriptRead | null {
  const text = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  try {
    const turns = turnsFrom(JSON.parse(text));
    if (turns && turns.length > 0) return { turns, skipped: 0 };
  } catch {
    // Truncated: close the array after the last complete turn object.
    const lastClose = text.lastIndexOf('}');
    if (lastClose === -1) return null;
    const head = text.slice(0, lastClose + 1);
    for (const tail of [']}', ']']) {
      try {
        const turns = turnsFrom(JSON.parse(head + tail));
        if (turns && turns.length > 0) return { turns, skipped: 0 };
      } catch {
        // try the next closing shape
      }
    }
  }
  const salvaged = salvageTurns(text);
  return salvaged.turns.length > 0 ? salvaged : null;
}

/** readTranscriptTurns without the skipped count. */
export function parseTranscriptTurns(raw: string): TranscriptTurn[] | null {
  return readTranscriptTurns(raw)?.turns ?? null;
}

/**
 * One line per speaker turn. Back-to-back turns by the same speaker are
 * merged so a new line always means a new speaker. Speakers keep the role
 * labels the model gave them; the teacher's name is never put in (privacy).
 */
export function formatTranscriptTurns(turns: TranscriptTurn[]): string {
  const merged: TranscriptTurn[] = [];
  for (const turn of turns) {
    const prev = merged[merged.length - 1];
    if (prev?.speaker === turn.speaker) {
      prev.text = `${prev.text} ${turn.text}`;
    } else {
      merged.push({ ...turn });
    }
  }
  return merged
    .map((turn) => {
      const stamp = turn.startSeconds === null ? '' : `${formatTimestamp(turn.startSeconds)} `;
      return `${stamp}${turn.speaker}: ${turn.text}`;
    })
    .join('\n');
}

/**
 * Masks letters and digits, keeping punctuation, quotes, backslashes and
 * spacing: enough to see how a reply's JSON broke without logging what was
 * said in the classroom.
 */
export function replyShape(text: string): string {
  return text.replace(/[\p{L}\p{N}]/gu, 'x');
}
