import { useMemo } from 'react';
import { where } from 'firebase/firestore';
import { COLLECTIONS, type TranscriptionJob } from '@ops/shared';
import { useFirestoreCollection } from '@/hooks/useFirestoreCollection';
import { groupLatestJobsByAudioFileId } from './transcriptionJobGrouping';

/**
 * Subscribes to `/transcriptionJobs` for the given observation, scoped to
 * the current user's own requests (matches firestore.rules — non-admin
 * readers may only `list` jobs where `requestedBy` is themselves). Returns
 * the latest job per `audioDriveFileId` so the UI can derive in-flight /
 * failed state that survives a page reload instead of relying on local
 * component state.
 */
export function useTranscriptionJobs(
  observationId: string,
  requestedBy: string | null,
): { jobsByAudioFileId: Record<string, TranscriptionJob & { id: string }>; loading: boolean } {
  const constraints = useMemo(
    () =>
      requestedBy
        ? [where('observationId', '==', observationId), where('requestedBy', '==', requestedBy)]
        : [],
    [observationId, requestedBy],
  );

  const { data, loading } = useFirestoreCollection<TranscriptionJob>(
    COLLECTIONS.transcriptionJobs,
    constraints,
    [observationId, requestedBy ?? ''],
  );

  const jobsByAudioFileId = useMemo(() => (data ? groupLatestJobsByAudioFileId(data) : {}), [data]);

  return { jobsByAudioFileId, loading: requestedBy ? loading : false };
}
