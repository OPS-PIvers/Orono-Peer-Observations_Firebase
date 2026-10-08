import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions';
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import {
  APP_SETTINGS_DOC_ID,
  COLLECTIONS,
  DEFAULT_GEMINI_MODEL,
  resolveGeminiModel,
} from '@ops/shared';
import {
  DRIVE_SECRETS,
  DRIVE_SERVICE_ACCOUNT,
  downloadFile,
  getDriveClient,
} from '../lib/drive.js';
import { vertexGenerateContent } from '../lib/vertexGemini.js';
import { deleteTranscriptionAudio, uploadTranscriptionAudio } from '../lib/transcriptionStorage.js';

if (getApps().length === 0) initializeApp();

const TRANSCRIPTION_PROMPT =
  'Transcribe the attached audio recording verbatim. Output only the transcript text — no headers, no speaker labels, no timestamps, no commentary. Preserve sentence boundaries with line breaks where natural pauses occur.';

/**
 * Resolves the Gemini model id from /appSettings/global. Admins pick the
 * model per Gemini-feature in the Settings page; we read it at job time so
 * a model swap takes effect without redeploying.
 */
async function resolveTranscriptionModel(): Promise<string> {
  try {
    const snap = await getFirestore()
      .doc(`${COLLECTIONS.appSettings}/${APP_SETTINGS_DOC_ID}`)
      .get();
    if (!snap.exists) return DEFAULT_GEMINI_MODEL;
    // Raw Firestore reads don't apply Zod defaults; partial-shape the tree.
    const settings = snap.data() as { gemini?: { audioTranscription?: { model?: string } } };
    return resolveGeminiModel(settings.gemini?.audioTranscription?.model);
  } catch (err) {
    logger.warn('resolveTranscriptionModel: settings fetch failed; using default', {
      error: err instanceof Error ? err.message : String(err),
    });
    return DEFAULT_GEMINI_MODEL;
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
        model,
      });

      const transcript = await transcribeWithGcsUri(audioUri, mimeType, model);

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

/**
 * Calls Vertex generateContent referencing the uploaded audio by gs:// URI.
 * No base64 encoding, no size cap.
 */
async function transcribeWithGcsUri(
  fileUri: string,
  mimeType: string,
  model: string,
): Promise<string> {
  const data = await vertexGenerateContent(
    model,
    {
      contents: [
        {
          role: 'user',
          parts: [{ text: TRANSCRIPTION_PROMPT }, { fileData: { fileUri, mimeType } }],
        },
      ],
    },
    'onTranscriptionJobCreated',
  );
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error('Gemini returned no transcript text');
  }
  return text.trim();
}
