import type { sheets_v4 } from 'googleapis';

/**
 * Google Sheets API client for the Master Log Sheet sync.
 *
 * Uses the Cloud Functions runtime SA (`peer-eval-svc@…`). The target
 * Sheet must be shared with that SA as an Editor. No DWD; the SA owns
 * the row writes directly.
 *
 * `googleapis` is lazily imported inside `getSheetsClient()` — see the
 * matching comment in `drive.ts` for why.
 */

let sheetsClient: sheets_v4.Sheets | null = null;

export async function getSheetsClient(): Promise<sheets_v4.Sheets> {
  if (sheetsClient) return sheetsClient;
  const { google } = await import('googleapis');
  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  sheetsClient = google.sheets({ version: 'v4', auth });
  return sheetsClient;
}
