import { email as emailSchema, type AiFeatureKey, type GeminiAccess } from '@ops/shared';

export const AI_FEATURE_TITLES: Record<AiFeatureKey, string> = {
  audioTranscription: 'Audio transcription',
  scriptAutoTag: 'Script auto-tag',
  transcriptSummary: 'Transcript summaries',
};

export const AI_FEATURE_META: {
  key: AiFeatureKey;
  title: string;
  description: string;
  hiddenWhenUnavailable: string;
}[] = [
  {
    key: 'audioTranscription',
    title: AI_FEATURE_TITLES.audioTranscription,
    description:
      'After a recording is saved, send the audio to the model and store the verbatim transcript on the observation.',
    hiddenWhenUnavailable:
      'Recording still works, but the Transcribe button, transcript status and transcript text are hidden.',
  },
  {
    key: 'scriptAutoTag',
    title: AI_FEATURE_TITLES.scriptAutoTag,
    description:
      'One-click button in the script editor that asks the model to tag verbatim spans with rubric components.',
    hiddenWhenUnavailable: 'The Auto-tag button is hidden from the script editor toolbar.',
  },
  {
    key: 'transcriptSummary',
    title: AI_FEATURE_TITLES.transcriptSummary,
    description:
      'Send to script options for a finished transcript: timestamped evidence for the assigned components, or a summary around a focus the observer types. Built from the stored transcript, so text-only models work.',
    hiddenWhenUnavailable:
      'Only the full transcript can be sent to the script (the Insert into script button). Needs Audio transcription too.',
  },
];

export const AI_ACCESS_OPTIONS: { value: GeminiAccess; label: string; help: string }[] = [
  { value: 'off', label: 'Off', help: 'Hidden from everyone.' },
  { value: 'beta', label: 'Beta', help: 'Only the people listed below.' },
  { value: 'all', label: 'On for everyone', help: 'Available to every user.' },
];

/** Split a pasted list on commas, semicolons and whitespace into valid and invalid addresses. */
export function parseEmailList(text: string): { valid: string[]; invalid: string[] } {
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const token of text.split(/[\s,;]+/)) {
    if (!token) continue;
    const parsed = emailSchema.safeParse(token);
    if (!parsed.success) invalid.push(token);
    else if (!valid.includes(parsed.data)) valid.push(parsed.data);
  }
  return { valid, invalid };
}
