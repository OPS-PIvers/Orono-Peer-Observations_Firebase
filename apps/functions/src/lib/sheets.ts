import { google, type sheets_v4 } from 'googleapis';

/**
 * Google Sheets API client for the Master Log Sheet sync.
 *
 * Uses the Cloud Functions runtime SA (`peer-eval-svc@…`). The target
 * Sheet must be shared with that SA as an Editor. No DWD; the SA owns
 * the row writes directly.
 */

let sheetsClient: sheets_v4.Sheets | null = null;

export function getSheetsClient(): sheets_v4.Sheets {
  if (sheetsClient) return sheetsClient;
  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  sheetsClient = google.sheets({ version: 'v4', auth });
  return sheetsClient;
}
