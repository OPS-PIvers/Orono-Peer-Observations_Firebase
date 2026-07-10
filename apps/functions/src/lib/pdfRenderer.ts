import { GoogleAuth } from 'google-auth-library';
import { defineString } from 'firebase-functions/params';
import type { Branding, Observation, Rubric, WorkProductQuestion } from '@ops/shared';

/**
 * URL of the deployed pdf-renderer Cloud Run service. Configured at deploy
 * time via `apps/functions/.env.peer-evaluator-rubric` (PDF_RENDERER_URL=...).
 */
const PDF_RENDERER_URL = defineString('PDF_RENDERER_URL');

let authClient: GoogleAuth | null = null;

function getAuth(): GoogleAuth {
  authClient ??= new GoogleAuth();
  return authClient;
}

export interface RenderObservationArgs {
  observation: Observation;
  rubric: Rubric;
  activeComponentIds: string[];
  /** Question bank for Work Product / Instructional Round observations, in
   *  display order, so the renderer can pair `workProductAnswers` with their
   *  question text. Omit for Standard observations. */
  workProductQuestions?: Pick<WorkProductQuestion, 'questionId' | 'text'>[];
  /** appSettings.branding (logoUrl/appName/primaryColor), so the archived
   *  PDF matches the web app and email branding. Omit to render with the
   *  packaged OPS defaults. */
  branding?: Pick<Branding, 'appName' | 'logoUrl' | 'primaryColor'>;
}

/**
 * POST the observation payload to the pdf-renderer Cloud Run service and
 * return the PDF bytes. Uses Cloud Run IAM auth: the calling service
 * account fetches an identity token for the target audience and presents
 * it as `Authorization: Bearer …`.
 */
export async function renderObservationPdf(args: RenderObservationArgs): Promise<Buffer> {
  const targetUrl = PDF_RENDERER_URL.value();
  if (!targetUrl) {
    throw new Error('PDF_RENDERER_URL is not configured');
  }
  const client = await getAuth().getIdTokenClient(targetUrl);
  const response = await client.request<ArrayBuffer>({
    url: `${targetUrl}/render-observation`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    data: args,
    responseType: 'arraybuffer',
  });
  return Buffer.from(response.data);
}
