import { google, type sheets_v4 } from 'googleapis';
import { GoogleAuth, Impersonated, type AuthClient } from 'google-auth-library';

/**
 * Sheets API helper.
 *
 * The default Google OAuth client used by `gcloud auth application-default
 * login` is locked out of Sheets / Drive scopes by Google's domain policy,
 * so we can't just lean on raw user ADC. Two supported paths:
 *
 *   1. **Impersonation (recommended).** Set `IMPERSONATE_SA` to a service
 *      account that has read access to the source spreadsheet. Your local
 *      ADC user identity needs `roles/iam.serviceAccountTokenCreator` on
 *      that SA. The default value targets `peer-eval-svc@…`, the same SA
 *      used elsewhere in the project.
 *   2. **Service account key.** Set `GOOGLE_APPLICATION_CREDENTIALS` to a
 *      JSON key for an SA with the same access. Bypasses impersonation.
 *
 * We resolve a single Sheets client and cache it. The Impersonated path
 * is async (it has to swap a source ADC token for an SA-scoped one), so
 * `getSheetsClient` is async — callers should await.
 */

const SHEETS_SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets.readonly',
  'https://www.googleapis.com/auth/drive.readonly',
];

const DEFAULT_IMPERSONATE_SA = 'peer-eval-svc@peer-evaluator-rubric.iam.gserviceaccount.com';

let sheetsClientPromise: Promise<sheets_v4.Sheets> | null = null;

export function getSheetsClient(): Promise<sheets_v4.Sheets> {
  sheetsClientPromise ??= buildSheetsClient();
  return sheetsClientPromise;
}

async function buildSheetsClient(): Promise<sheets_v4.Sheets> {
  const auth = await buildAuth();
  return google.sheets({ version: 'v4', auth });
}

async function buildAuth(): Promise<AuthClient> {
  // Explicit opt-out: useful if someone has a service-account key file via
  // GOOGLE_APPLICATION_CREDENTIALS and just wants the default flow.
  if (process.env['IMPERSONATE_SA'] === '') {
    const ga = new GoogleAuth({ scopes: SHEETS_SCOPES });
    return ga.getClient();
  }
  const targetSa = process.env['IMPERSONATE_SA'] ?? DEFAULT_IMPERSONATE_SA;
  // Source: whatever ADC resolves to (typically the developer's gcloud
  // login). Cloud-platform scope is the default and is enough to call
  // IAM.signBlob for the impersonation exchange.
  const sourceClient = await new GoogleAuth().getClient();
  return new Impersonated({
    sourceClient,
    targetPrincipal: targetSa,
    targetScopes: SHEETS_SCOPES,
    lifetime: 3600,
  });
}

/** Read all rows from a single tab on a spreadsheet. Returns rows as
 *  arrays of strings (empty cells become empty strings, not undefined). */
export async function readSheetValues(sheetId: string, tabName: string): Promise<string[][]> {
  const sheets = await getSheetsClient();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `'${tabName}'`,
    majorDimension: 'ROWS',
    valueRenderOption: 'FORMATTED_VALUE',
  });
  const values = response.data.values ?? [];
  // Normalize undefined cells → ''
  return values.map((row) =>
    row.map((cell): string => (cell == null ? '' : String(cell as unknown))),
  );
}

/** List all tabs (sheet names) in the spreadsheet. */
export async function listTabs(sheetId: string): Promise<string[]> {
  const sheets = await getSheetsClient();
  const response = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
  return (response.data.sheets ?? [])
    .map((s) => s.properties?.title)
    .filter((t): t is string => typeof t === 'string');
}
