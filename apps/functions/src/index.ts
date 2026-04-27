/**
 * Cloud Functions entrypoint.
 *
 * All deployable functions are re-exported from here. Firebase deploys based
 * on what this file exports.
 *
 * Phase 1: Auth blocking function (domain check) is the only export.
 * Phase 2+: observation lifecycle (create/save/finalize), transcription
 * orchestration, master log Sheet sync, audit log pruning all hang off here.
 */

export { beforeUserCreated } from './auth/beforeCreate.js';
