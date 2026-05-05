import { z } from 'zod';
import { email, isoDate } from './common.js';

/**
 * /transcriptionJobs/{jobId} — async Gemini transcription jobs.
 *
 * Created when the client requests transcription of an audio file. The
 * Cloud Run worker picks it up, calls Gemini, writes the transcript text
 * back to /observations/{id}.transcripts[audioFileId], and updates this
 * job doc to "Completed" or "Failed".
 *
 * Client uses `onSnapshot` on the job doc to surface progress in the UI.
 */

export const transcriptionStatus = z.enum(['Pending', 'Running', 'Completed', 'Failed']);
export type TranscriptionStatus = z.infer<typeof transcriptionStatus>;

export const transcriptionJob = z.object({
  jobId: z.string().min(1),
  observationId: z.string().min(1),
  audioDriveFileId: z.string().min(1),
  /** Email of the PE who requested the transcription. */
  requestedBy: email,
  status: transcriptionStatus.default('Pending'),
  startedAt: isoDate.nullable().default(null),
  completedAt: isoDate.nullable().default(null),
  /** Filled when status === 'Failed'. */
  error: z.string().nullable().default(null),
  /** When status === 'Completed', also populated for convenience (the
   *  authoritative copy lives on /observations/{id}.transcripts[audioFileId]). */
  transcriptPreview: z.string().nullable().default(null),
  /** Gemini Files API URI (e.g. "files/abc123") for the temporarily uploaded
   *  audio. Set right after upload and cleared after successful delete in the
   *  worker's finally block. A stale non-null value on an old job indicates
   *  the worker died before cleanup; pruneOrphanGeminiFiles reclaims it. */
  geminiFileUri: z.string().nullable().default(null),
  createdAt: isoDate,
});
export type TranscriptionJob = z.infer<typeof transcriptionJob>;
