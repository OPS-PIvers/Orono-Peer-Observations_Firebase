import type { TranscriptionJob, TranscriptionStatus } from '@ops/shared';
import { useFirestoreDoc } from './useFirestoreDoc';

export interface TranscriptionJobState {
  status: TranscriptionStatus | null;
  error: string | null;
  transcriptPreview: string | null;
  loading: boolean;
}

/**
 * Subscribe to a `/transcriptionJobs/{jobId}` document via `onSnapshot` and
 * expose the job's status, error, and transcript preview. Designed to be
 * called per-recording inside `AudioRecorder` so the UI can render
 * Pending/Running/Completed/Failed states live without polling.
 *
 * Pass `null` (or `undefined`) when no job has been started yet — the hook
 * returns `{ status: null, error: null, transcriptPreview: null, loading: false }`.
 */
export function useTranscriptionJob(jobId: string | null | undefined): TranscriptionJobState {
  const path = jobId ? `transcriptionJobs/${jobId}` : '';
  const { data, loading } = useFirestoreDoc<TranscriptionJob>(path);

  if (!jobId) {
    return { status: null, error: null, transcriptPreview: null, loading: false };
  }

  return {
    status: data?.status ?? null,
    error: data?.error ?? null,
    transcriptPreview: data?.transcriptPreview ?? null,
    loading,
  };
}
