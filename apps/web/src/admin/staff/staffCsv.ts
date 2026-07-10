import { serverTimestamp } from 'firebase/firestore';
import {
  ALLOWED_EMAIL_DOMAIN,
  COLLECTIONS,
  isStaffYear,
  staffInput,
  type ModuleDoc,
  type Role,
  type Staff,
  type StaffInput,
} from '@ops/shared';

/**
 * The staff schema's `emailPreferences` has a zod default (all opted-in) and
 * no CSV column, so validating a CSV row against the full `staffInput` would
 * inject that default into every row and the merge write would clobber
 * opt-outs staff set themselves (Profile → email preferences). Imports must
 * never touch the field, so it's omitted from the row schema entirely.
 */
const staffCsvInput = staffInput.omit({ emailPreferences: true });
export type StaffCsvInput = Omit<StaffInput, 'emailPreferences'>;
import { bulkMergePerRow } from '@/admin/_shared/bulkWrite';
import { toJsDate } from '@/utils/staffFormatting';

/**
 * Bulk CSV import/export for the staff roster (StaffPage). Hand-written CSV
 * parse/serialize — deliberately no dependency, since the app only ever
 * reads/writes this one shape.
 *
 * Round-trip contract: a file downloaded from `serializeStaffCsv` re-imports
 * through `parseStaffCsv` with every row landing as "unchanged" (aside from
 * `createdAt`/`updatedAt`, which are server-managed and ignored on import).
 * `emailPreferences` is deliberately excluded in both directions — it's
 * self-service data owned by each staff member, never bulk-managed by CSV.
 */

/** Column order for exported/imported staff CSVs. */
export const STAFF_CSV_COLUMNS = [
  'email',
  'name',
  'role',
  'year',
  'summativeYear',
  'buildings',
  'modules',
  'isActive',
  'hasAdminAccess',
  'createdAt',
  'updatedAt',
] as const;
export type StaffCsvColumn = (typeof STAFF_CSV_COLUMNS)[number];

/** Columns required to resolve a valid staff record. `createdAt`/`updatedAt`
 *  are exported for reference but server-stamped, so they're not required
 *  (or read) on import. */
const REQUIRED_COLUMNS: StaffCsvColumn[] = [
  'email',
  'name',
  'role',
  'year',
  'summativeYear',
  'buildings',
  'modules',
  'isActive',
  'hasAdminAccess',
];

/** Separator used inside a single CSV field for list values (buildings,
 *  modules). A semicolon+space reads cleanly and never collides with the
 *  comma field delimiter. */
const LIST_SEPARATOR = '; ';

// ---------------------------------------------------------------------------
// CSV primitives (hand-written — no papaparse/csv-parse dependency)
// ---------------------------------------------------------------------------

/** Quote a single CSV field per RFC 4180 whenever it contains a comma,
 *  quote, or newline; embedded quotes are doubled. */
export function csvEscapeField(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function csvSerializeRow(fields: readonly string[]): string {
  return fields.map(csvEscapeField).join(',');
}

/**
 * Parse raw CSV text into rows of string fields. Supports quoted fields
 * with embedded commas/newlines and escaped quotes (`""` -> `"`), both
 * CRLF and LF line endings, and a trailing blank line.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < n) {
    const ch = text.charAt(i);
    if (inQuotes) {
      if (ch === '"') {
        if (text.charAt(i + 1) === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      endField();
      i += 1;
      continue;
    }
    if (ch === '\r') {
      // Swallow bare CR; a following \n (CRLF) drives the row break below.
      i += 1;
      continue;
    }
    if (ch === '\n') {
      endRow();
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  if (field.length > 0 || row.length > 0) {
    endRow();
  }
  // Drop wholly-blank trailing rows (a trailing newline produces one).
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

function formatCsvDate(value: unknown): string {
  const d = toJsDate(value);
  return d ? d.toISOString() : '';
}

/** Serialize the full staff roster to CSV text (CRLF line endings). Role and
 *  module ids are rendered as their human-readable display names so the
 *  file is reviewable/editable in a spreadsheet; re-import resolves names
 *  back to ids. */
export function serializeStaffCsv(
  staffList: readonly Staff[],
  roles: readonly Role[],
  modules: readonly ModuleDoc[],
): string {
  const roleLabel = new Map(roles.map((r) => [r.roleId, r.displayName]));
  const moduleLabel = new Map(modules.map((m) => [m.moduleId, m.displayName]));

  const lines = [csvSerializeRow(STAFF_CSV_COLUMNS)];
  for (const s of staffList) {
    lines.push(
      csvSerializeRow([
        s.email,
        s.name,
        roleLabel.get(s.role) ?? s.role,
        String(s.year),
        String(s.summativeYear),
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Firestore reads bypass Zod defaults; older docs may lack this field
        (s.buildings ?? []).join(LIST_SEPARATOR),
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Firestore reads bypass Zod defaults; older docs may lack this field
        (s.modules ?? []).map((id) => moduleLabel.get(id) ?? id).join(LIST_SEPARATOR),
        String(s.isActive),
        String(s.hasAdminAccess),
        formatCsvDate(s.createdAt),
        formatCsvDate(s.updatedAt),
      ]),
    );
  }
  return lines.join('\r\n') + '\r\n';
}

/** Trigger a browser download of `text` as a file. Browser-only — not
 *  meaningful in a test/node environment. */
export function downloadTextFile(text: string, filename: string, mimeType: string): void {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ---------------------------------------------------------------------------
// Import: parse + validate + diff
// ---------------------------------------------------------------------------

export type StaffCsvRowAction = 'create' | 'update' | 'unchanged' | 'error';

export interface StaffCsvRow {
  /** 1-based row number within the data rows (header excluded). */
  rowNumber: number;
  /** Raw cell text keyed by canonical column name, for the preview table. */
  raw: Record<StaffCsvColumn, string>;
  /** Resolved + zod-validated record, or null when `errors` is non-empty. */
  input: StaffCsvInput | null;
  errors: string[];
  action: StaffCsvRowAction;
}

export interface StaffCsvParseResult {
  rows: StaffCsvRow[];
  /** Header cells that didn't match a known column — surfaced as a
   *  non-blocking warning (forwards-compatible with extra columns). */
  unknownColumns: string[];
  /** Required columns missing from the header — blocks parsing entirely. */
  missingColumns: StaffCsvColumn[];
}

interface ResolveContext {
  roles: readonly Role[];
  modules: readonly ModuleDoc[];
  existingByEmail: ReadonlyMap<string, Staff>;
}

function dedupe(values: readonly string[]): string[] {
  return Array.from(new Set(values));
}

function sameStringSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

/** True when `next` (a resolved import row) would leave `existing` byte-for-
 *  field unchanged — drives the create/update/unchanged diff. */
function staffInputEquals(existing: Staff, next: StaffCsvInput): boolean {
  return (
    existing.name === next.name &&
    existing.role === next.role &&
    existing.year === next.year &&
    existing.summativeYear === next.summativeYear &&
    existing.isActive === next.isActive &&
    existing.hasAdminAccess === next.hasAdminAccess &&
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Firestore reads bypass Zod defaults; older docs may lack these fields
    sameStringSet(existing.buildings ?? [], next.buildings) &&
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Firestore reads bypass Zod defaults; older docs may lack these fields
    sameStringSet(existing.modules ?? [], next.modules)
  );
}

function resolveRole(raw: string, roles: readonly Role[], errors: string[]): string {
  const v = raw.trim();
  if (!v) {
    errors.push('Role is required.');
    return '';
  }
  const byId = roles.find((r) => r.roleId === v);
  if (byId) return byId.roleId;
  const byName = roles.find((r) => r.displayName.toLowerCase() === v.toLowerCase());
  if (byName) return byName.roleId;
  errors.push(`Unknown role "${v}" — use a role's exact name from Admin → Roles.`);
  return v;
}

function resolveYear(raw: string, errors: string[]): number {
  const trimmed = raw.trim();
  const n = Number(trimmed);
  if (trimmed === '' || !isStaffYear(n)) {
    errors.push(`Year must be 1-6 (got "${raw}").`);
    return 1;
  }
  return n;
}

function resolveBool(raw: string, label: string, errors: string[], defaultValue: boolean): boolean {
  const v = raw.trim().toLowerCase();
  if (v === '') return defaultValue;
  if (['true', '1', 'yes', 'y'].includes(v)) return true;
  if (['false', '0', 'no', 'n'].includes(v)) return false;
  errors.push(`${label} must be true/false (got "${raw}").`);
  return defaultValue;
}

function resolveBuildings(raw: string): string[] {
  return dedupe(
    raw
      .split(';')
      .map((b) => b.trim())
      .filter(Boolean),
  );
}

function resolveModules(raw: string, modules: readonly ModuleDoc[], errors: string[]): string[] {
  const names = raw
    .split(';')
    .map((m) => m.trim())
    .filter(Boolean);
  const ids: string[] = [];
  for (const n of names) {
    const byId = modules.find((m) => m.moduleId === n);
    if (byId) {
      ids.push(byId.moduleId);
      continue;
    }
    const byName = modules.find((m) => m.displayName.toLowerCase() === n.toLowerCase());
    if (byName) {
      ids.push(byName.moduleId);
      continue;
    }
    errors.push(`Unknown module "${n}" — use a module's exact name from Admin → Modules.`);
  }
  return dedupe(ids);
}

function resolveStaffRow(
  raw: Record<StaffCsvColumn, string>,
  ctx: ResolveContext,
): { input: StaffCsvInput | null; errors: string[] } {
  const errors: string[] = [];

  const email = raw.email.trim().toLowerCase();
  if (!email) {
    errors.push('Email is required.');
  } else if (!email.includes('@')) {
    errors.push(`"${raw.email}" is not a valid email.`);
  } else if (!email.endsWith(`@${ALLOWED_EMAIL_DOMAIN}`)) {
    errors.push(`Email must be a @${ALLOWED_EMAIL_DOMAIN} address (got "${raw.email}").`);
  }

  const name = raw.name.trim();
  if (!name) errors.push('Name is required.');

  const roleId = resolveRole(raw.role, ctx.roles, errors);
  const year = resolveYear(raw.year, errors);
  const summativeYear = resolveBool(raw.summativeYear, 'Summative year', errors, false);
  const isActive = resolveBool(raw.isActive, 'Active', errors, true);
  const hasAdminAccess = resolveBool(raw.hasAdminAccess, 'Admin access', errors, false);
  const buildings = resolveBuildings(raw.buildings);
  const modules = resolveModules(raw.modules, ctx.modules, errors);

  if (errors.length > 0) return { input: null, errors };

  const parsed = staffCsvInput.safeParse({
    email,
    name,
    role: roleId,
    year,
    buildings,
    modules,
    summativeYear,
    isActive,
    hasAdminAccess,
  });
  if (!parsed.success) {
    return {
      input: null,
      errors: parsed.error.issues.map(
        (issue) => `${issue.path.length > 0 ? issue.path.join('.') : 'row'}: ${issue.message}`,
      ),
    };
  }
  return { input: parsed.data, errors: [] };
}

/** Parse + validate a staff CSV file against the current roles/modules
 *  lists and the existing roster (for the create/update/unchanged diff). */
export function parseStaffCsv(text: string, ctx: ResolveContext): StaffCsvParseResult {
  const table = parseCsv(text);
  if (table.length === 0) {
    return { rows: [], unknownColumns: [], missingColumns: [...REQUIRED_COLUMNS] };
  }

  const header = (table[0] ?? []).map((h) => h.trim());
  const colIndex = new Map<string, number>();
  header.forEach((h, idx) => {
    const key = h.toLowerCase();
    if (!colIndex.has(key)) colIndex.set(key, idx);
  });

  const knownLower = new Set<string>(STAFF_CSV_COLUMNS.map((c) => c.toLowerCase()));
  const unknownColumns = header.filter((h) => h !== '' && !knownLower.has(h.toLowerCase()));
  const missingColumns = REQUIRED_COLUMNS.filter((c) => !colIndex.has(c.toLowerCase()));

  const rows: StaffCsvRow[] = [];
  if (missingColumns.length > 0) {
    return { rows, unknownColumns, missingColumns };
  }

  const seenEmails = new Map<string, number>();

  for (let i = 1; i < table.length; i += 1) {
    const record = table[i] ?? [];
    if (record.every((f) => f.trim() === '')) continue; // blank line

    const raw = {} as Record<StaffCsvColumn, string>;
    for (const col of STAFF_CSV_COLUMNS) {
      const idx = colIndex.get(col.toLowerCase());
      raw[col] = idx !== undefined ? (record[idx] ?? '').trim() : '';
    }

    const rowNumber = i; // header is row 0, so data row i is "row i" (1-based, matches spreadsheet row - 1)
    const { input, errors } = resolveStaffRow(raw, ctx);

    let finalInput = input;
    const rowErrors = [...errors];
    if (finalInput) {
      const dupeRow = seenEmails.get(finalInput.email);
      if (dupeRow !== undefined) {
        rowErrors.push(`Duplicate email — also appears on row ${String(dupeRow)} of this file.`);
        finalInput = null;
      } else {
        seenEmails.set(finalInput.email, rowNumber);
      }
    }

    let action: StaffCsvRowAction = 'error';
    if (finalInput && rowErrors.length === 0) {
      const existing = ctx.existingByEmail.get(finalInput.email);
      action = !existing
        ? 'create'
        : staffInputEquals(existing, finalInput)
          ? 'unchanged'
          : 'update';
    }

    rows.push({ rowNumber, raw, input: finalInput, errors: rowErrors, action });
  }

  return { rows, unknownColumns, missingColumns };
}

/** Commit the create/update rows of a parsed CSV via chunked batched writes
 *  (mirrors BulkEditDialog's use of bulkMergePerRow). Rows with action
 *  'unchanged' or 'error' are skipped. */
export async function commitStaffCsvRows(
  rows: readonly StaffCsvRow[],
  existingByEmail: ReadonlyMap<string, Staff>,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const toCommit = rows.filter(
    (r): r is StaffCsvRow & { input: StaffCsvInput } =>
      (r.action === 'create' || r.action === 'update') && r.input !== null,
  );
  const byEmail = new Map(toCommit.map((r) => [r.input.email, r]));
  const ids = toCommit.map((r) => r.input.email);

  await bulkMergePerRow(
    COLLECTIONS.staff,
    ids,
    (id) => {
      const row = byEmail.get(id);
      if (!row) return null;
      const isNew = !existingByEmail.has(id);
      return { ...row.input, ...(isNew ? { createdAt: serverTimestamp() } : {}) };
    },
    onProgress,
  );
}
