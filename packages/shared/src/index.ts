/**
 * @ops/shared — workspace-internal package shared by web, functions, and
 * pdf-renderer.
 *
 * Phase 1: minimal — domain constant + role enum + brand tokens.
 * Phase 2: full Firestore Zod schemas land here.
 */

export * from './constants.js';
export * from './roles.js';
export * from './cycle.js';
export * from './brand.js';
export * from './email/renderEmailShell.js';
export * from './schema/index.js';
