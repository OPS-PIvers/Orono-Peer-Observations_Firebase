import {
  isStaffYear,
  type Role,
  type Rubric,
  type RubricComponent,
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

    const yearNum = Number(yearStr);
    if (!isStaffYear(yearNum)) {
      warnings.push(`Row ${i + 1} (${emailRaw}): year "${yearStr}" not 1-6 — defaulting to 1`);
    }
    const year: StaffYear = isStaffYear(yearNum) ? yearNum : 1;

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
      isActive: true,
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

const COMPONENT_ID_PATTERN = /^([1-9])([a-z]):?$/;

export function parseRubric(input: ParseRubricInput): ParseRubricResult {
  const { rubricId, displayName, rows } = input;
  const domainNames = { ...DEFAULT_DOMAIN_NAMES, ...(input.domainNames ?? {}) };
  const warnings: string[] = [];
  const domainsMap = new Map<string, RubricDomain>();

  // Skim through rows looking for component header rows. Anything that
  // matches "1a:", "2c:", etc. in column A starts a new component.
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (!row) continue;
    const aCell = (row[0] ?? '').trim().toLowerCase();
    const match = COMPONENT_ID_PATTERN.exec(aCell);
    if (!match) continue;

    const compId = `${match[1] ?? ''}${match[2] ?? ''}`;
    const domainNum = match[1] ?? '1';
    const title = (row[1] ?? '').trim() || compId;

    // Next 5 rows: developing / basic / proficient / distinguished / best practices.
    const desc = (offset: number): string => {
      const r = rows[i + offset];
      if (!r) return '';
      return r
        .filter((c): c is string => typeof c === 'string')
        .map((c) => c.trim())
        .filter(Boolean)
        .join('\n');
    };

    const component: RubricComponent = {
      id: compId,
      title: title.slice(0, 200),
      proficiencyLevels: {
        developing: desc(1),
        basic: desc(2),
        proficient: desc(3),
        distinguished: desc(4),
      },
      bestPractices: desc(5),
      lookFors: [], // can be enriched later from a separate look-fors sheet
    };

    let domain = domainsMap.get(domainNum);
    if (!domain) {
      domain = {
        id: domainNum,
        name: domainNames[domainNum] ?? `Domain ${domainNum}`,
        components: [],
      };
      domainsMap.set(domainNum, domain);
    }
    domain.components.push(component);
  }

  const domains: RubricDomain[] = Array.from(domainsMap.values()).sort((a, b) =>
    a.id.localeCompare(b.id),
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
