import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { defineSecret } from 'firebase-functions/params';
import { logger } from 'firebase-functions';
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { COLLECTIONS } from '@ops/shared';
import { downloadFile, getDriveClient } from '../lib/drive.js';

if (getApps().length === 0) initializeApp();

/**
 * Public Gemini API key (`generativelanguage.googleapis.com`). Stored as a
 * Secret Manager secret; configured once via:
 *
 *   firebase functions:secrets:set GEMINI_API_KEY
 *
 * The key is created in https://aistudio.google.com/apikey and tied to the
 * same GCP project as the rest of the app for billing simplicity.
 */
const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY');

const TRANSCRIPTION_PROMPT =
  'Transcribe the attached audio recording verbatim. Output only the transcript text — no headers, no speaker labels, no timestamps, no commentary. Preserve sentence boundaries with line breaks where natural pauses occur.';

const GEMINI_MODEL = 'gemini-2.5-flash';

/** Hard cap to keep the inline-data path safe; ~15MB raw audio. */
const MAX_AUDIO_BYTES = 15 * 1024 * 1024;

/**
 * Firestore-triggered worker that processes transcription jobs.
 *
 * Lifecycle:
 *   Pending → Running → Completed (transcript on observation.transcripts[fileId])
 *                     ↘ Failed (job.error populated)
 *
 * Reads audio bytes from Drive (SA-owned), sends inline base64 to the
 * Gemini API, and writes the resulting transcript back. The observation
 * doc's onSnapshot in the editor surfaces the new transcript live.
 */
export const onTranscriptionJobCreated = onDocumentCreated(
  {
    document: 'transcriptionJobs/{jobId}',
    region: 'us-central1',
    secrets: [GEMINI_API_KEY],
    memory: '1GiB',
    timeoutSeconds: 540,
  },
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) return;
    const job = snapshot.data() as {
      observationId: string;
      audioDriveFileId: string;
      status: string;
    };
    if (job.status !== 'Pending') {
      logger.info('onTranscriptionJobCreated: skipping, status not Pending', {
        jobId: snapshot.id,
        status: job.status,
      });
      return;
    }

    const jobRef = snapshot.ref;
    const db = getFirestore();
    const obsRef = db.doc(`${COLLECTIONS.observations}/${job.observationId}`);

    await jobRef.update({ status: 'Running', startedAt: FieldValue.serverTimestamp() });

    try {
      const drive = getDriveClient();
      const meta = await drive.files.get({
        fileId: job.audioDriveFileId,
        fields: 'mimeType, size',
      });
      const mimeType = meta.data.mimeType ?? 'audio/webm';
      const sizeBytes = meta.data.size ? Number(meta.data.size) : 0;
      if (sizeBytes > MAX_AUDIO_BYTES) {
        throw new Error(
          `Audio is too large for inline transcription (${formatMb(sizeBytes)} > ${formatMb(MAX_AUDIO_BYTES)}). Split the recording into shorter clips.`,
        );
      }

      const audio = await downloadFile(job.audioDriveFileId);
      const transcript = await transcribeWithGemini(audio, mimeType, GEMINI_API_KEY.value());

      await obsRef.update({
        [`transcripts.${job.audioDriveFileId}`]: transcript,
        lastModifiedAt: FieldValue.serverTimestamp(),
      });
      await jobRef.update({
        status: 'Completed',
        completedAt: FieldValue.serverTimestamp(),
        transcriptPreview: transcript.slice(0, 280),
      });
      logger.info('Transcription completed', {
        jobId: snapshot.id,
        observationId: job.observationId,
        transcriptLength: transcript.length,
      });
    } catch (err) {
      logger.error('Transcription failed', {
        jobId: snapshot.id,
        error: err instanceof Error ? err.message : String(err),
      });
      await jobRef.update({
        status: 'Failed',
        completedAt: FieldValue.serverTimestamp(),
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  },
);

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
}

async function transcribeWithGemini(
  audio: Buffer,
  mimeType: string,
  apiKey: string,
): Promise<string> {
  const base64 = audio.toString('base64');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [{ text: TRANSCRIPTION_PROMPT }, { inlineData: { mimeType, data: base64 } }],
        },
      ],
    }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gemini API error ${String(response.status)}: ${text.slice(0, 500)}`);
  }
  const data = (await response.json()) as GeminiResponse;
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error('Gemini returned no transcript text');
  }
  return text.trim();
}

function formatMb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
