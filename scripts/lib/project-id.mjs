/**
 * Centralized Firebase project ID for scripts.
 *
 * Reads from FIREBASE_PROJECT_ID env var; defaults to 'peer-evaluator-rubric'
 * (the district's production project). To target a different project, set:
 *
 *   FIREBASE_PROJECT_ID=my-project-id node script-name.mjs
 *
 * This default is the documented fallback and should match the project
 * used by the Firebase CLI and Cloud Run services.
 */

export const PROJECT_ID = process.env.FIREBASE_PROJECT_ID ?? 'peer-evaluator-rubric';
