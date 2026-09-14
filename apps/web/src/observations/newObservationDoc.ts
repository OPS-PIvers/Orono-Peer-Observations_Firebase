import { serverTimestamp } from 'firebase/firestore';
import { OBSERVATION_STATUS, type ObservationType, type Staff } from '@ops/shared';

/**
 * The document a peer evaluator's client writes to start a Draft
 * observation. Shared by CreateObservationDialog and the evaluator
 * checklist's "Start observation & mark done" so both create identical
 * drafts (the rules' create check requires `observerEmail` to be the
 * caller and `status` Draft).
 */
export function newDraftObservationDoc(args: {
  observerEmail: string;
  /** Denormalized so the observed staff member's dashboard can show the
   *  evaluator without read access to their /staff doc. */
  observerName: string;
  staff: Staff;
  type: ObservationType;
  observationName?: string;
}) {
  const { staff } = args;
  return {
    observerEmail: args.observerEmail.toLowerCase(),
    observerName: args.observerName,
    observedEmail: staff.email.toLowerCase(),
    observedName: staff.name,
    observedRole: staff.role,
    observedYear: staff.year,
    observedBuildings: staff.buildings,
    status: OBSERVATION_STATUS.draft,
    type: args.type,
    observationName: (args.observationName ?? '').trim(),
    observationData: {},
    componentNotes: {},
    evidenceLinks: {},
    componentTags: [],
    workProductAnswers: [],
    audioDriveFileIds: [],
    transcripts: {},
    driveFolderId: null,
    pdfDriveFileId: null,
    observationDate: new Date(),
    createdAt: serverTimestamp(),
    lastModifiedAt: serverTimestamp(),
    finalizedAt: null,
  };
}
