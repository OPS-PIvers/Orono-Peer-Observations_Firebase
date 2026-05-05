import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { defineSecret } from 'firebase-functions/params';
import { logger } from 'firebase-functions';
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { COLLECTIONS } from '@ops/shared';
import { downloadFile, getDriveClient } from '../lib/drive.js';

if (getApps().length === 0) initializeApp();

const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY');

const TRANSCRIPTION_PROMPT =
  'Transcribe the attached audio recording verbatim. Output only the transcript text — no headers, no speaker labels, no timestamps, no commentary. Preserve sentence boundaries with line breaks where natural pauses occur.';

const GEMINI_MODEL = 'gemini-3.1-flash-lite-preview';

const GEMINI_FILES_BASE = 'https://generativelanguage.googleapis.com';

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

    let geminiFileUri: string | null = null;

    try {
      const drive = getDriveClient();
      const meta = await drive.files.get({
        fileId: job.audioDriveFileId,
        fields: 'mimeType, size, name',
      });
      const mimeType = meta.data.mimeType ?? 'audio/webm';
      const sizeBytes = meta.data.size ? Number(meta.data.size) : 0;

      logger.info('onTranscriptionJobCreated: downloading audio', {
        jobId: snapshot.id,
        sizeBytes,
        mimeType,
      });

      const audio = await downloadFile(job.audioDriveFileId);

      geminiFileUri = await uploadToGeminiFiles(
        audio,
        mimeType,
        meta.data.name ?? 'recording',
        GEMINI_API_KEY.value(),
      );

      logger.info('onTranscriptionJobCreated: uploaded to Gemini Files API', {
        jobId: snapshot.id,
        geminiFileUri,
      });

      const transcript = await transcribeWithGeminiFileUri(
        geminiFileUri,
        mimeType,
        GEMINI_API_KEY.value(),
      );

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
      if (geminiFileUri) {
        await deleteGeminiFile(geminiFileUri, GEMINI_API_KEY.value()).catch((e: unknown) => {
          logger.warn('onTranscriptionJobCreated: failed to delete Gemini temp file', {
            geminiFileUri,
            error: String(e),
          });
        });
      }
    }
  },
);

/**
 * Uploads audio bytes to the Gemini Files API using a resumable upload.
 * Returns the file URI (e.g. "files/abc123") to reference in generateContent.
 *
 * Gemini Files API stores the file temporarily (48 hours). We delete it
 * immediately after transcription in the finally block above.
 */
async function uploadToGeminiFiles(
  audio: Buffer,
  mimeType: string,
  displayName: string,
  apiKey: string,
): Promise<string> {
  const initResponse = await fetch(
    `${GEMINI_FILES_BASE}/upload/v1beta/files?uploadType=resumable&key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': String(audio.length),
        'X-Goog-Upload-Header-Content-Type': mimeType,
      },
      body: JSON.stringify({ file: { displayName } }),
    },
  );

  if (!initResponse.ok) {
    const text = await initResponse.text();
    throw new Error(
      `Gemini Files API init failed ${String(initResponse.status)}: ${text.slice(0, 300)}`,
    );
  }

  const uploadUrl = initResponse.headers.get('x-goog-upload-url');
  if (!uploadUrl) {
    throw new Error('Gemini Files API did not return an upload URL');
  }

  const uploadResponse = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Content-Length': String(audio.length),
      'X-Goog-Upload-Offset': '0',
      'X-Goog-Upload-Command': 'upload, finalize',
    },
    body: audio,
  });

  if (!uploadResponse.ok) {
    const text = await uploadResponse.text();
    throw new Error(
      `Gemini Files API upload failed ${String(uploadResponse.status)}: ${text.slice(0, 300)}`,
    );
  }

  const fileData = (await uploadResponse.json()) as { file?: { uri?: string; state?: string } };
  const uri = fileData.file?.uri;
  if (!uri) {
    throw new Error('Gemini Files API upload response missing file URI');
  }

  await waitForGeminiFileActive(uri, apiKey);

  return uri;
}

/**
 * Extracts the bare file name (e.g. "abc123") from a Gemini Files URI,
 * which can be either "files/abc123" or a full "https://.../files/abc123" form.
 */
function geminiFileName(fileUri: string): string {
  if (fileUri.startsWith('https://')) {
    const tail = fileUri.split('/files/')[1];
    if (!tail) throw new Error(`Unrecognized Gemini file URI: ${fileUri}`);
    return tail;
  }
  return fileUri.replace(/^files\//, '');
}

/**
 * Polls the Gemini Files API until the file state is ACTIVE.
 * New uploads start as PROCESSING; FAILED is terminal.
 *
 * Default budget: 100 × 3s = 5 minutes. The Cloud Function has a 9-minute
 * timeout, so this leaves headroom for the actual transcription call.
 */
async function waitForGeminiFileActive(
  fileUri: string,
  apiKey: string,
  maxAttempts = 100,
  delayMs = 3000,
): Promise<void> {
  const fileName = geminiFileName(fileUri);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await fetch(
      `${GEMINI_FILES_BASE}/v1beta/files/${fileName}?key=${encodeURIComponent(apiKey)}`,
    );
    if (!res.ok) {
      throw new Error(`Gemini Files status check failed: ${String(res.status)}`);
    }
    const data = (await res.json()) as { state?: string };
    if (data.state === 'ACTIVE') return;
    if (data.state === 'FAILED') {
      throw new Error('Gemini Files API reported file processing FAILED');
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error('Timed out waiting for Gemini file to become ACTIVE');
}

/**
 * Calls generateContent referencing the uploaded file by URI.
 * No base64 encoding, no size cap.
 */
async function transcribeWithGeminiFileUri(
  fileUri: string,
  mimeType: string,
  apiKey: string,
): Promise<string> {
  const url = `${GEMINI_FILES_BASE}/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [{ text: TRANSCRIPTION_PROMPT }, { fileData: { fileUri, mimeType } }],
        },
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Gemini generateContent failed ${String(response.status)}: ${text.slice(0, 500)}`,
    );
  }

  const data = (await response.json()) as GeminiResponse;
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error('Gemini returned no transcript text');
  }
  return text.trim();
}

/**
 * Deletes a file from Gemini Files API storage.
 * Called in finally to avoid accumulating temp files in the project quota.
 *
 * 404 is treated as success (file already gone). Other non-OK responses throw
 * so the caller's `.catch` can log a warning.
 */
async function deleteGeminiFile(fileUri: string, apiKey: string): Promise<void> {
  const fileName = geminiFileName(fileUri);

  const res = await fetch(
    `${GEMINI_FILES_BASE}/v1beta/files/${fileName}?key=${encodeURIComponent(apiKey)}`,
    { method: 'DELETE' },
  );
  if (!res.ok && res.status !== 404) {
    const text = await res.text().catch(() => '');
    throw new Error(`Gemini Files delete failed ${String(res.status)}: ${text.slice(0, 200)}`);
  }
}

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
}
