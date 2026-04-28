/**
 * Cloud Functions entrypoint.
 *
 * All deployable functions are re-exported from here. Firebase deploys based
 * on what this file exports.
 *
 * Auth: syncMyClaims (callable, post-sign-in claim sync) +
 *       onStaffWritten (Firestore trigger to propagate role changes).
 *       The legacy `beforeUserCreated` blocking function was removed —
 *       blocking functions require Identity Platform (paid).
 * Phase 5: Audio upload + download + transcription request + worker.
 * Phase 6: Finalize observation, PDF orchestration, Drive folder share.
 */

export { syncMyClaims } from './auth/syncMyClaims.js';
export { onStaffWritten } from './auth/onStaffWritten.js';
export { uploadAudio } from './audio/uploadAudio.js';
export { getAudio } from './audio/getAudio.js';
export { requestTranscription } from './transcription/requestTranscription.js';
export { onTranscriptionJobCreated } from './transcription/onTranscriptionJobCreated.js';
export { finalizeObservation } from './observations/finalizeObservation.js';
export { onObservationWritten } from './observations/onObservationWritten.js';
export { pruneAuditLog } from './audit/pruneAuditLog.js';
