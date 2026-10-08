import { GoogleAuth } from 'google-auth-library';
import { defineString } from 'firebase-functions/params';
import { HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';

/**
 * Region for Vertex AI Gemini calls. Override with VERTEX_LOCATION in
 * `apps/functions/.env.peer-evaluator-rubric`; use `global` if the chosen
 * model isn't offered regionally.
 */
const VERTEX_LOCATION = defineString('VERTEX_LOCATION', { default: 'us-central1' });

let authClient: GoogleAuth | null = null;

function getAuth(): GoogleAuth {
  authClient ??= new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  return authClient;
}

export interface GeminiContentPart {
  text?: string;
}

export interface GeminiGenerateContentResponse {
  candidates?: { content?: { parts?: GeminiContentPart[] } }[];
}

/**
 * Calls Vertex AI `generateContent` as the function's service account (no API
 * key; needs the Vertex AI API enabled and `roles/aiplatform.user`). Failures
 * are logged in full and thrown as an HttpsError with a message that is safe
 * to show to staff.
 */
export async function vertexGenerateContent(
  model: string,
  body: unknown,
  logContext: string,
): Promise<GeminiGenerateContentResponse> {
  const auth = getAuth();
  const project = process.env['GCLOUD_PROJECT'] ?? (await auth.getProjectId());
  const location = VERTEX_LOCATION.value();
  const host = location === 'global' ? 'aiplatform.googleapis.com' : `${location}-aiplatform.googleapis.com`;
  const url =
    `https://${host}/v1/projects/${project}/locations/${location}` +
    `/publishers/google/models/${model}:generateContent`;

  const token = await auth.getAccessToken();
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token ?? ''}` },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    logger.error(`${logContext}: Vertex AI request failed`, {
      status: response.status,
      model,
      location,
      body: text.slice(0, 500),
    });
    throw geminiHttpsError(response.status, text);
  }
  return (await response.json()) as GeminiGenerateContentResponse;
}

/**
 * Maps a failed Gemini response to an HttpsError whose message is meant for
 * staff, never the raw provider JSON (which can name billing consoles and
 * projects).
 */
export function geminiHttpsError(status: number, bodyText: string): HttpsError {
  const quota = status === 402 || status === 429 || bodyText.includes('RESOURCE_EXHAUSTED');
  if (quota) {
    return new HttpsError(
      'resource-exhausted',
      'AI features are temporarily unavailable. Please try again later or contact your administrator.',
    );
  }
  if (status === 401 || status === 403 || status === 404) {
    return new HttpsError(
      'failed-precondition',
      'AI features are not set up correctly. Please contact your administrator.',
    );
  }
  return new HttpsError('internal', 'The AI service returned an error. Please try again.');
}
