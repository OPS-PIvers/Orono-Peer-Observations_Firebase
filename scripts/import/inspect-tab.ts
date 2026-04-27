import { config as loadDotenv } from 'dotenv';
import { readSheetValues } from './sheets.js';

/**
 * Quick inspection helper — prints the raw rows of a Sheet tab so we can
 * eyeball the structure when the parser misbehaves.
 *
 *   GAS_SOURCE_SHEET_ID=... pnpm tsx scripts/import/inspect-tab.ts Teacher 30
 */

loadDotenv();

const tab = process.argv[2];
const limitRaw = process.argv[3];
const limit = limitRaw ? Number(limitRaw) : 30;

if (!tab) {
  console.error('Usage: tsx scripts/import/inspect-tab.ts <tab-name> [limit]');
  process.exit(1);
}

const sheetId = process.env['GAS_SOURCE_SHEET_ID'];
if (!sheetId) {
  console.error('GAS_SOURCE_SHEET_ID env var required');
  process.exit(1);
}

const rows = await readSheetValues(sheetId, tab);
console.log(`Tab "${tab}" has ${String(rows.length)} rows`);
console.log(`Showing first ${String(Math.min(limit, rows.length))} rows:\n`);

for (let i = 0; i < Math.min(limit, rows.length); i += 1) {
  const row = rows[i] ?? [];
  const cells = row
    .map((c, j) => `[${String(j)}] "${c.length > 80 ? c.slice(0, 80) + '…' : c}"`)
    .join('  ');
  console.log(`Row ${String(i)}: ${cells || '(empty)'}`);
}
