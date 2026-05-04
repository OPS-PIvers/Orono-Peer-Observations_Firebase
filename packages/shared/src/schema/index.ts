/**
 * @ops/shared/schema — Zod schemas for every Firestore entity.
 *
 * These are the authoritative shapes: web client, Cloud Functions, the
 * Cloud Run PDF renderer, and the import script all consume from here.
 *
 * Naming convention:
 *   - `<entity>` — full doc shape, includes server-managed fields like
 *     createdAt / updatedAt
 *   - `<entity>Input` — what an admin/user form submits (omits server
 *     timestamps)
 *   - `<Entity>` — TypeScript type inferred from the schema
 */

export * from './common.js';
export * from './staff.js';
export * from './role.js';
export * from './building.js';
export * from './rubric.js';
export * from './settings.js';
export * from './observation.js';
export * from './workProductQuestion.js';
export * from './emailTemplate.js';
export * from './auditLog.js';
export * from './transcriptionJob.js';
