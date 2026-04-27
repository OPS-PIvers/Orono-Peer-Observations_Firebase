import { google } from 'googleapis';

/**
 * Sheets API helper. Uses Application Default Credentials — run
 *   gcloud auth application-default login
 * before invoking the import script, or set GOOGLE_APPLICATION_CREDENTIALS
 * to a service account key with Drive/Sheets read access for the source
 * spreadsheet.
 */
export function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets.readonly',
      'https://www.googleapis.com/auth/drive.readonly',
    ],
  });
  return google.sheets({ version: 'v4', auth });
}

/** Read all rows from a single tab on a spreadsheet. Returns rows as
 *  arrays of strings (empty cells become empty strings, not undefined). */
export async function readSheetValues(sheetId: string, tabName: string): Promise<string[][]> {
  const sheets = getSheetsClient();
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
  const sheets = getSheetsClient();
  const response = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
  return (response.data.sheets ?? [])
    .map((s) => s.properties?.title)
    .filter((t): t is string => typeof t === 'string');
}
