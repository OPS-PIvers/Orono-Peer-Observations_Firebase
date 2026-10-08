import { defineString } from 'firebase-functions/params';
import { getStorage } from 'firebase-admin/storage';

/**
 * Scratch bucket holding recordings only while Gemini transcribes them.
 * The worker deletes each object when it finishes; the bucket's 1-day
 * lifecycle rule is the backstop for crashed runs.
 */
const TRANSCRIPTION_BUCKET = defineString('TRANSCRIPTION_BUCKET', {
  default: 'peer-evaluator-rubric-transcription-tmp',
});

/** Uploads audio to the scratch bucket and returns its `gs://` URI. */
export async function uploadTranscriptionAudio(
  jobId: string,
  audio: Buffer,
  mimeType: string,
): Promise<string> {
  const bucketName = TRANSCRIPTION_BUCKET.value();
  await getStorage()
    .bucket(bucketName)
    .file(`transcription/${jobId}`)
    .save(audio, { contentType: mimeType, resumable: false });
  return `gs://${bucketName}/transcription/${jobId}`;
}

/**
 * Deletes an object by `gs://` URI. A missing object counts as success.
 * Legacy Gemini Files API URIs (`files/…`, from before the Vertex move)
 * expire on Google's side after 48 hours, so there is nothing to delete.
 */
export async function deleteTranscriptionAudio(uri: string): Promise<void> {
  const parsed = parseGcsUri(uri);
  if (!parsed) return;
  await getStorage()
    .bucket(parsed.bucket)
    .file(parsed.object)
    .delete({ ignoreNotFound: true });
}

export function parseGcsUri(uri: string): { bucket: string; object: string } | null {
  const groups = /^gs:\/\/(?<bucket>[^/]+)\/(?<object>.+)$/.exec(uri)?.groups;
  if (!groups?.['bucket'] || !groups['object']) return null;
  return { bucket: groups['bucket'], object: groups['object'] };
}
