import {
  isStaffYear,
  type Role,
  type Rubric,
  type RubricDomain,
  type Staff,
  type StaffYear,
  type WorkProductQuestion,
  type RoleYearMapping,
} from '@ops/shared';

/**
 * GAS-Sheet → Zod-schema parsers. These mirror the parse logic from the
 * legacy SheetService.js (peer-evaluator-form-main/server/SheetService.js).
 *
 * Conventions in the source spreadsheet (verified by exploration of the
 * GAS codebase):
 *
 *   - Staff sheet:    NAME | EMAIL | ROLE | YEAR | BUILDING | SUMMATIVE_YEAR
 *                     (header row at index 0; data starts row 1)
 *   - Settings sheet: ROLE | YEAR_1 | YEAR_2 | YEAR_3 | PROB_1 | PROB_2 | PROB_3
 *                     (4 rows per role, one per Domain 1-4; cells are
 *                     comma-separated component IDs like "1a, 1c, 1f")
 *   - Per-role rubric (Teacher / Nurse / etc.): column A holds component IDs
 *                     suffixed with ":" (e.g., "1a:") followed by 4 proficiency
 *                     descriptor rows + 1 best-practices row + look-fors.
 *
 * Where the source data is malformed, parsers throw with a row-level
 * message so the import script can surface where to look in the sheet.
 */

const HEADER_ROW = 0;

// ────────────────────────────────────────────────────────────────────────
// Staff
// ────────────────────────────────────────────────────────────────────────

const STAFF_COLUMNS = {
  NAME: 0,
  EMAIL: 1,
  ROLE: 2,
  YEAR: 3,
  BUILDING: 4,
  SUMMATIVE_YEAR: 5,
} as const;

export interface ParseStaffResult {
  staff: Omit<Staff, 'createdAt' | 'updatedAt'>[];
  warnings: string[];
}

/** Email accounts that exist in the Staff sheet but aren't real staff
 *  (system mailboxes, automation accounts). These get filtered entirely. */
const STAFF_EMAIL_BLOCKLIST = new Set<string>(['notifications@orono.k12.mn.us']);

/** Map the Staff sheet's text year values to numeric StaffYear (1-6).
 *  The legacy GAS app stores years as text — "Year 1", "Year 2", "Year 3",
 *  "P1", "P2", "P3" — but our schema uses 1-6 (with 4-6 as P1-P3).
 *  Empty / unrecognized values mean "not in an active eval cycle" and the
 *  staff member is deactivated.
 */
function parseStaffYear(value: string): { year: StaffYear; recognized: boolean } {
  const v = value.trim().toLowerCase().replace(/\s+/g, ' ');
  if (v === 'year 1' || v === '1') return { year: 1, recognized: true };
  if (v === 'year 2' || v === '2') return { year: 2, recognized: true };
  if (v === 'year 3' || v === '3') return { year: 3, recognized: true };
  if (v === 'p1' || v === '4') return { year: 4, recognized: true };
  if (v === 'p2' || v === '5') return { year: 5, recognized: true };
  if (v === 'p3' || v === '6') return { year: 6, recognized: true };
  // Last-ditch numeric coerce (handles weird formatted values).
  const n = Number(v);
  if (isStaffYear(n)) return { year: n, recognized: true };
  return { year: 1, recognized: false };
}

export function parseStaff(rows: string[][]): ParseStaffResult {
  const staff: ParseStaffResult['staff'] = [];
  const warnings: string[] = [];

  for (let i = HEADER_ROW + 1; i < rows.length; i += 1) {
    const row = rows[i];
    if (!row) continue;
    const name = (row[STAFF_COLUMNS.NAME] ?? '').trim();
    const emailRaw = (row[STAFF_COLUMNS.EMAIL] ?? '').trim().toLowerCase();
    const role = (row[STAFF_COLUMNS.ROLE] ?? '').trim();
    const yearStr = (row[STAFF_COLUMNS.YEAR] ?? '').trim();
    const buildingRaw = (row[STAFF_COLUMNS.BUILDING] ?? '').trim();
    const summativeYearRaw = (row[STAFF_COLUMNS.SUMMATIVE_YEAR] ?? '').trim();

    if (!name && !emailRaw) continue; // blank row
    if (!emailRaw.includes('@')) {
      warnings.push(`Row ${i + 1}: missing/invalid email — skipped (name="${name}")`);
      continue;
    }
    if (STAFF_EMAIL_BLOCKLIST.has(emailRaw)) {
      warnings.push(`Row ${i + 1} (${emailRaw}): system account — skipped`);
      continue;
    }

    const { year, recognized } = parseStaffYear(yearStr);
    // Staff with missing/unrecognized year are imported as inactive; admins
    // can reactivate via the Staff admin page after assigning a real year.
    const isActive = recognized && yearStr !== '';
    if (!recognized && yearStr !== '') {
      warnings.push(
        `Row ${i + 1} (${emailRaw}): year "${yearStr}" unrecognized — imported inactive`,
      );
    }

    const buildings = buildingRaw
      .split(',')
      .map((b) => b.trim())
      .filter(Boolean);

    const summativeYear =
      summativeYearRaw.toLowerCase() === 'true' ||
      summativeYearRaw.toLowerCase() === 'yes' ||
      summativeYearRaw === '1';

    staff.push({
      email: emailRaw,
      name: name || emailRaw,
      role: role || 'Teacher',
      year,
      buildings,
      summativeYear,
      isActive,
    });
  }

  return { staff, warnings };
}

// ────────────────────────────────────────────────────────────────────────
// Settings (role/year → assigned components)
// ────────────────────────────────────────────────────────────────────────

const SETTINGS_COLUMNS = {
  ROLE: 0,
  YEAR_1: 1,
  YEAR_2: 2,
  YEAR_3: 3,
  PROB_1: 4,
  PROB_2: 5,
  PROB_3: 6,
} as const;

const YEAR_COLUMN_MAP: ReadonlyMap<StaffYear, number> = new Map([
  [1, SETTINGS_COLUMNS.YEAR_1],
  [2, SETTINGS_COLUMNS.YEAR_2],
  [3, SETTINGS_COLUMNS.YEAR_3],
  [4, SETTINGS_COLUMNS.PROB_1],
  [5, SETTINGS_COLUMNS.PROB_2],
  [6, SETTINGS_COLUMNS.PROB_3],
]);

export interface ParseSettingsResult {
  mappings: Omit<RoleYearMapping, 'updatedAt'>[];
  warnings: string[];
}

/**
 * Parses the Settings sheet's 4-row-per-role block layout.
 *
 * For each role, 4 consecutive rows (one per domain). Each (year-column,
 * row) cell holds a comma-separated list of component IDs ("1a, 1c, 1f").
 * We aggregate across all 4 domain rows to produce a single
 * `assignedComponentIds` array per (roleId, year).
 *
 * `roleNameToId` maps the human-readable role name (column A) to the
 * Firestore role document ID (slug).
 */
export function parseSettings(
  rows: string[][],
  roleNameToId: Map<string, string>,
): ParseSettingsResult {
  const accumulator = new Map<string, Set<string>>(); // key: `${roleId}_${year}`
  const warnings: string[] = [];

  let i = HEADER_ROW + 1;
  while (i < rows.length) {
    const row = rows[i];
    if (!row) {
      i += 1;
      continue;
    }
    const roleName = (row[SETTINGS_COLUMNS.ROLE] ?? '').trim();
    if (!roleName) {
      i += 1;
      continue;
    }
    const roleId = roleNameToId.get(roleName);
    if (!roleId) {
      warnings.push(`Row ${i + 1}: unknown role "${roleName}" — skipping its 4 rows`);
      i += 4;
      continue;
    }

    // Collect this role's 4 domain rows (i, i+1, i+2, i+3).
    for (let d = 0; d < 4 && i + d < rows.length; d += 1) {
      const domainRow = rows[i + d];
      if (!domainRow) continue;
      for (const [year, col] of YEAR_COLUMN_MAP) {
        const cell = (domainRow[col] ?? '').trim();
        if (!cell) continue;
        const ids = cell
          .split(',')
          .map((id) => id.trim().toLowerCase())
          .filter(Boolean);
        const key = `${roleId}_${String(year)}`;
        let set = accumulator.get(key);
        if (!set) {
          set = new Set<string>();
          accumulator.set(key, set);
        }
        for (const id of ids) set.add(id);
      }
    }
    i += 4;
  }

  const mappings: ParseSettingsResult['mappings'] = [];
  for (const [key, set] of accumulator) {
    const sep = key.lastIndexOf('_');
    const roleId = key.slice(0, sep);
    const yearStr = key.slice(sep + 1);
    const yearNum = Number(yearStr);
    if (!isStaffYear(yearNum)) continue;
    mappings.push({
      roleId,
      year: yearNum,
      assignedComponentIds: Array.from(set).sort(),
    });
  }

  return { mappings, warnings };
}

// ────────────────────────────────────────────────────────────────────────
// Role rubric sheets (Teacher, Nurse, Counselor, ...)
// ────────────────────────────────────────────────────────────────────────

/**
 * Parse a per-role rubric sheet into a Rubric object.
 *
 * The legacy GAS sheet structure:
 *   - Row 0 (A): Title (e.g., "Danielson Framework for Teaching")
 *   - Row 1 (A): Subtitle
 *   - Rows 2+ : repeating block of 6 rows per component:
 *       row+0 (A): "1a:"   (component ID followed by ":")
 *       row+0 (B): component title (e.g., "Demonstrating Knowledge of Content")
 *       row+1: Developing descriptor (concatenate all non-empty cells in row)
 *       row+2: Basic descriptor
 *       row+3: Proficient descriptor
 *       row+4: Distinguished descriptor
 *       row+5: Best Practices (and any additional bulleted items)
 *
 * Domain transitions are determined by the leading digit of the component ID:
 *   1a-1f → Domain 1
 *   2a-2e → Domain 2
 *   3a-3e → Domain 3
 *   4a-4f → Domain 4
 *
 * Domain names are not in the source sheet — they're inferred from the
 * Danielson convention. If parsing a non-Danielson rubric, the caller can
 * override DEFAULT_DOMAIN_NAMES.
 */
const DEFAULT_DOMAIN_NAMES: Record<string, string> = {
  '1': 'Planning and Preparation',
  '2': 'Classroom Environment',
  '3': 'Instruction',
  '4': 'Professional Responsibilities',
};

export interface ParseRubricInput {
  rubricId: string;
  displayName: string;
  rows: string[][];
  domainNames?: Record<string, string>;
}

export interface ParseRubricResult {
  rubric: Omit<Rubric, 'createdAt' | 'updatedAt'>;
  warnings: string[];
}

/** Match a row whose col[0] starts a new component, e.g.
 *    "1a: Applying Knowledge of Content and Pedagogy"
 *  Trailing whitespace / tabs are common in the legacy sheet so we
 *  tolerate them. */
const COMPONENT_ROW_PATTERN = /^([1-9])([a-z])\s*:\s*(.+?)\s*$/;

/** Match "Domain 1: Planning and Preparation" — used to pick up the
 *  authoritative domain name from the sheet rather than relying on the
 *  hardcoded DEFAULT_DOMAIN_NAMES. */
const DOMAIN_ROW_PATTERN = /^Domain\s+(\d+)\s*:\s*(.+?)\s*$/i;

export function parseRubric(input: ParseRubricInput): ParseRubricResult {
  const { rubricId, displayName, rows } = input;
  const fallbackDomainNames = { ...DEFAULT_DOMAIN_NAMES, ...(input.domainNames ?? {}) };
  const warnings: string[] = [];
  const domainsMap = new Map<string, RubricDomain>();

  // Track the most recently seen domain header so each component slots
  // into the right domain. The actual sheet structure is:
  //   Row N:    "Domain 1: ..."             (domain header)
  //   Row N+1:  "" | "Developing" | "Basic" | ... (column headers)
  //   Row N+2:  "1a: Title" | descriptor | descriptor | descriptor | descriptor | "Rating"
  //   Row N+3:  "" | "Best Practices Aligned with ..." (sub-header, skip)
  //   Row N+4:  "" | "<best practices content>"
  //   Row N+5:  "1b: Title" ...
  //   ...
  let currentDomainId: string | null = null;
  let currentDomainName: string | null = null;

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (!row) continue;
    const aCell = (row[0] ?? '').trim();

    const domainMatch = DOMAIN_ROW_PATTERN.exec(aCell);
    if (domainMatch) {
      currentDomainId = domainMatch[1] ?? null;
      currentDomainName = (domainMatch[2] ?? '').trim();
      continue;
    }

    const compMatch = COMPONENT_ROW_PATTERN.exec(aCell);
    if (!compMatch) continue;

    const compId = `${compMatch[1] ?? ''}${compMatch[2] ?? ''}`;
    const compTitle = (compMatch[3] ?? '').trim();
    const domainDigit = compMatch[1] ?? '1';

    // Best Practices content is 2 rows below the component row, in col[1]
    // (col[0] is empty, col[1] holds the multi-line content with embedded
    // newlines preserved by the Sheets API).
    const bpRow = rows[i + 2];
    const bestPractices = (bpRow?.[1] ?? '').trim();

    const domainKey = currentDomainId ?? domainDigit;
    let domain = domainsMap.get(domainKey);
    if (!domain) {
      domain = {
        id: domainKey,
        name: currentDomainName ?? fallbackDomainNames[domainDigit] ?? `Domain ${domainDigit}`,
        components: [],
      };
      domainsMap.set(domainKey, domain);
    }

    domain.components.push({
      id: compId,
      title: compTitle.slice(0, 200),
      proficiencyLevels: {
        developing: (row[1] ?? '').trim(),
        basic: (row[2] ?? '').trim(),
        proficient: (row[3] ?? '').trim(),
        distinguished: (row[4] ?? '').trim(),
      },
      bestPractices,
      lookFors: [], // not present in the GAS rubric sheets — admins add via UI
    });
  }

  const domains: RubricDomain[] = Array.from(domainsMap.values()).sort((a, b) =>
    a.id.localeCompare(b.id, undefined, { numeric: true }),
  );

  if (domains.length === 0) {
    warnings.push(`Rubric "${rubricId}" parsed 0 components — sheet structure may not match.`);
  }

  return {
    rubric: {
      rubricId,
      displayName,
      domains,
    },
    warnings,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Roles (derived from per-role tabs)
// ────────────────────────────────────────────────────────────────────────

const SPECIAL_ACCESS_NAMES = new Set(['Administrator', 'Peer Evaluator', 'Full Access']);

/** Slugify a role display name → role document ID. */
export function roleNameToSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function roleFromName(name: string): Omit<Role, 'createdAt' | 'updatedAt'> {
  const roleId = roleNameToSlug(name);
  return {
    roleId,
    displayName: name,
    isSpecialAccess: SPECIAL_ACCESS_NAMES.has(name),
    rubricId: roleId,
    isActive: true,
  };
}

// ────────────────────────────────────────────────────────────────────────
// WorkProductQuestions
// ────────────────────────────────────────────────────────────────────────

const WPQ_COLUMNS = { ID: 0, TEXT: 1 } as const;

export interface ParseWorkProductQuestionsResult {
  questions: Omit<WorkProductQuestion, 'createdAt' | 'updatedAt'>[];
  warnings: string[];
}

export function parseWorkProductQuestions(rows: string[][]): ParseWorkProductQuestionsResult {
  const questions: ParseWorkProductQuestionsResult['questions'] = [];
  const warnings: string[] = [];

  let order = 0;
  for (let i = HEADER_ROW + 1; i < rows.length; i += 1) {
    const row = rows[i];
    if (!row) continue;
    const idRaw = (row[WPQ_COLUMNS.ID] ?? '').trim();
    const text = (row[WPQ_COLUMNS.TEXT] ?? '').trim();
    if (!text) continue;
    const questionId = idRaw ? roleNameToSlug(idRaw) : `q-${String(order + 1)}`;
    questions.push({
      questionId,
      text,
      order,
      isActive: true,
    });
    order += 1;
  }
  return { questions, warnings };
}
