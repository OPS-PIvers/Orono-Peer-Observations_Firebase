import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions';
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { COLLECTIONS, DEFAULT_AI_MODEL, type AiModel } from '@ops/shared';
import {
  DRIVE_SECRETS,
  DRIVE_SERVICE_ACCOUNT,
  downloadFile,
  getDriveClient,
} from '../lib/drive.js';
import { generateTextResult, loadFeatureModel } from '../lib/aiClient.js';
import { deleteTranscriptionAudio, uploadTranscriptionAudio } from '../lib/transcriptionStorage.js';
import {
  TRANSCRIPTION_PROMPT,
  TRANSCRIPT_TURNS_SCHEMA,
  formatTranscriptTurns,
  readTranscriptTurns,
  replyShape,
} from './transcriptTurns.js';

if (getApps().length === 0) initializeApp();

/**
 * The model transcription is routed to on the AI Models admin page, read at
 * job time so a model swap takes effect without redeploying. Only
 * audio-capable models qualify; anything else resolves to one that is.
 */
async function resolveTranscriptionModel(): Promise<AiModel> {
  try {
    return await loadFeatureModel(getFirestore(), 'audioTranscription');
  } catch (err) {
    logger.warn('resolveTranscriptionModel: settings fetch failed; using default', {
      error: err instanceof Error ? err.message : String(err),
    });
    return DEFAULT_AI_MODEL;
  }
}

export const onTranscriptionJobCreated = onDocumentCreated(
  {
    document: 'transcriptionJobs/{jobId}',
    region: 'us-central1',
    serviceAccount: DRIVE_SERVICE_ACCOUNT,
    secrets: [...DRIVE_SECRETS],
    memory: '1GiB',
    timeoutSeconds: 540,
    // maxInstances caps concurrent transcription work to bound cost/abuse
    // exposure — not copied from onObservationWritten's maxInstances: 1, which
    // exists there solely to respect the Sheets API's 60-writes/min quota.
    maxInstances: 10,
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

    let audioUri: string | null = null;

    try {
      const drive = await getDriveClient();
      const meta = await drive.files.get({
        fileId: job.audioDriveFileId,
        fields: 'mimeType, size, name',
        supportsAllDrives: true,
      });
      const mimeType = meta.data.mimeType ?? 'audio/webm';
      const sizeBytes = meta.data.size ? Number(meta.data.size) : 0;

      logger.info('onTranscriptionJobCreated: downloading audio', {
        jobId: snapshot.id,
        sizeBytes,
        mimeType,
      });

      const audio = await downloadFile(job.audioDriveFileId);

      audioUri = await uploadTranscriptionAudio(snapshot.id, audio, mimeType);

      // Persist the URI so a separate sweep can clean it up if this
      // instance dies (timeout/OOM) before the finally block runs.
      await jobRef.update({ geminiFileUri: audioUri });

      const model = await resolveTranscriptionModel();
      logger.info('onTranscriptionJobCreated: uploaded audio for Gemini', {
        jobId: snapshot.id,
        audioUri,
        model: model.id,
      });

      // No names go to the model or into the transcript: speakers are
      // labeled by role only (Teacher, Student) for privacy.
      const transcript = await transcribeWithGcsUri(audioUri, mimeType, model, {
        userEmail: (snapshot.data() as { requestedBy?: string }).requestedBy ?? null,
        observationId: job.observationId,
      });

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
    } finally {
      if (audioUri) {
        try {
          await deleteTranscriptionAudio(audioUri);
          await jobRef.update({ geminiFileUri: null });
        } catch (e: unknown) {
          logger.warn('onTranscriptionJobCreated: failed to delete temp audio', {
            audioUri,
            error: String(e),
          });
          // Leave geminiFileUri set on the job; pruneOrphanGeminiFiles will retry.
        }
      }
    }
  },
);

/** Appended when the model ran out of output before the recording ended. */
export const TRANSCRIPT_CUT_OFF_NOTE =
  '[Transcript stops here: the recording was too long to transcribe in full. The rest of the audio is in the recording.]';

/** Appended when some turns of the reply could not be read and were left out. */
export function transcriptGapsNote(skipped: number): string {
  return `[${String(skipped)} part${skipped === 1 ? '' : 's'} of this transcript could not be read and ${skipped === 1 ? 'is' : 'are'} missing. The full audio is in the recording.]`;
}

/**
 * Calls Vertex generateContent referencing the uploaded audio by gs:// URI.
 * No base64 encoding, no size cap. Returns one line per speaker turn,
 * "[MM:SS] Speaker: text".
 */
async function transcribeWithGcsUri(
  fileUri: string,
  mimeType: string,
  model: AiModel,
  caller: { userEmail: string | null; observationId: string },
): Promise<string> {
  const { text, truncated } = await generateTextResult(
    model,
    {
      prompt: TRANSCRIPTION_PROMPT,
      fileData: { fileUri, mimeType },
      jsonSchema: TRANSCRIPT_TURNS_SCHEMA,
      // Lowest randomness: the model should copy what it hears, not rephrase.
      temperature: 0,
    },
    { feature: 'audioTranscription', logContext: 'onTranscriptionJobCreated', ...caller },
  );
  if (!text.trim()) {
    throw new Error('Gemini returned no transcript text');
  }
  const read = readTranscriptTurns(text);
  if (read) {
    // Keep what was transcribed, but never let a cut-off or gappy transcript
    // pass for the whole recording.
    const notes = [
      ...(read.skipped > 0 ? [transcriptGapsNote(read.skipped)] : []),
      ...(truncated ? [TRANSCRIPT_CUT_OFF_NOTE] : []),
    ];
    return [formatTranscriptTurns(read.turns), ...notes].join('\n\n');
  }
  // The model answered in plain text instead of JSON: keep what it said.
  if (!/^\s*(```|[[{])/.test(text)) {
    return truncated ? `${text.trim()}\n\n${TRANSCRIPT_CUT_OFF_NOTE}` : text.trim();
  }
  // Shape only, so the next unreadable reply can be diagnosed from the logs:
  // where it starts and how it ends says whether it was cut off, looped, or
  // broke the JSON. Words are masked; classroom speech stays out of the logs.
  logger.error('onTranscriptionJobCreated: unreadable transcript reply', {
    model: model.id,
    truncated,
    length: text.length,
    head: replyShape(text.slice(0, 120)),
    tail: replyShape(text.slice(-200)),
  });
  throw new Error(
    truncated
      ? 'Gemini ran out of room before finishing the first part of the transcript'
      : 'Gemini returned a transcript that could not be read',
  );
}
