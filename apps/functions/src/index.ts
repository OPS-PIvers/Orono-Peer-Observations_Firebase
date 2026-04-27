/**
 * Cloud Functions entrypoint.
 *
 * All deployable functions are re-exported from here. Firebase deploys based
 * on what this file exports.
 *
 * Phase 1: Auth blocking function (domain check).
 * Phase 5: Audio upload + download + transcription request + worker.
 * Phase 6: Finalize observation, PDF orchestration, Drive folder share.
 */

export { beforeUserCreated } from './auth/beforeCreate.js';
export { uploadAudio } from './audio/uploadAudio.js';
export { getAudio } from './audio/getAudio.js';
export { requestTranscription } from './transcription/requestTranscription.js';
export { onTranscriptionJobCreated } from './transcription/onTranscriptionJobCreated.js';
