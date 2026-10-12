import { HttpsError } from 'firebase-functions/v2/https';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { COLLECTIONS, canOpenAdminConsole, type Staff } from '@ops/shared';
import { onCall } from '../lib/callable.js';
import { ANTHROPIC_API_KEY } from '../lib/aiClient.js';

if (getApps().length === 0) initializeApp();

export interface AiProviderStatus {
  /** Gemini runs through Vertex AI as the function's service account; no key to set. */
  gemini: { configured: true };
  /** Whether the ANTHROPIC_API_KEY secret holds a value. The key itself never leaves the server. */
  claude: { configured: boolean };
}

/** Admin-only: which providers the server can call, for the AI Models page. */
export const getAiProviderStatus = onCall(
  { region: 'us-central1', memory: '256MiB', timeoutSeconds: 30, secrets: [ANTHROPIC_API_KEY] },
  async (request): Promise<AiProviderStatus> => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required');
    const userEmail = request.auth.token.email?.toLowerCase();
    if (!userEmail) throw new HttpsError('unauthenticated', 'Token has no email');

    const callerSnap = await getFirestore().doc(`${COLLECTIONS.staff}/${userEmail}`).get();
    const caller = callerSnap.exists ? (callerSnap.data() as Staff) : null;
    if (!caller || !canOpenAdminConsole(caller.role, caller.hasAdminAccess)) {
      throw new HttpsError('permission-denied', 'Admin only');
    }

    return {
      gemini: { configured: true },
      claude: { configured: ANTHROPIC_API_KEY.value().trim().length > 0 },
    };
  },
);
