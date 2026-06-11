/**
 * Sheet → Firestore import — Phase 2 implementation.
 *
 * Reads the legacy GAS app's source spreadsheet (set via GAS_SOURCE_SHEET_ID
 * env var) and writes its contents into Firestore using the schema in
 * @ops/shared.
 *
 * Targets:
 *   --target=emulator     writes to Firestore emulator on 127.0.0.1:8080
 *   --target=prod         writes to live Firestore (peer-evaluator-rubric).
 *                         Requires --confirm flag and refuses to run if
 *                         the prod database already contains data, unless
 *                         --force-overwrite is also passed.
 *
 * Auth (prod target):
 *   - gcloud auth application-default login   (recommended for one-shot
 *     interactive runs by Paul)
 *   - OR set GOOGLE_APPLICATION_CREDENTIALS to a JSON key path
 *
 * The script never imports Draft observations — only Finalized ones come
 * across as historical archive.
 */

import { config as loadDotenv } from 'dotenv';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { COLLECTIONS, OBSERVATION_STATUS, slugifyRoleName } from '@ops/shared';
import { initFirestore, type ImportTarget } from './firebase.js';
import { listTabs, readSheetValues } from './sheets.js';
import {
  parseRubric,
  parseSettings,
  parseStaff,
  parseWorkProductQuestions,
  roleFromName,
} from './parsers.js';
import { APP_SETTINGS_PATH, SYSTEM_TEMPLATES, defaultAppSettings } from './seed.js';

loadDotenv();

const GAS_TAB_NAMES = {
  staff: 'Staff',
  settings: 'Settings',
  workProductQuestions: 'WorkProductQuestions',
  observationData: 'Observation_Data',
} as const;

/** Tabs that exist in the GAS spreadsheet but are NOT role rubrics — used
 *  to exclude them from auto-discovery as role tabs. The legacy
 *  WorkProductAnswers sheet is the most common false positive. */
const NON_ROLE_TABS = new Set<string>([...Object.values(GAS_TAB_NAMES), 'WorkProductAnswers']);

interface CliArgs {
  target: ImportTarget | 'dry-run';
  confirm: boolean;
  forceOverwrite: boolean;
  skipObservations: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const target = argv.find((a) => a.startsWith('--target='))?.split('=')[1];
  if (target !== 'emulator' && target !== 'prod' && target !== 'dry-run') {
    throw new Error(
      'Usage: --target=emulator|prod|dry-run [--confirm] [--force-overwrite] [--skip-observations]',
    );
  }
  return {
    target,
    confirm: argv.includes('--confirm'),
    forceOverwrite: argv.includes('--force-overwrite'),
    skipObservations: argv.includes('--skip-observations'),
  };
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Required env var ${name} not set`);
  return v;
}

async function ensureProdSafe(db: Firestore | null, args: CliArgs) {
  if (args.target !== 'prod' || !db) return;
  if (!args.confirm) {
    throw new Error(
      'Refusing to run against prod without --confirm. This is a destructive operation.',
    );
  }
  const staffSnap = await db.collection(COLLECTIONS.staff).limit(1).get();
  if (!staffSnap.empty && !args.forceOverwrite) {
    throw new Error(
      'Prod Firestore already has data in /staff. Re-running would overwrite. ' +
        'If this is intentional, also pass --force-overwrite.',
    );
  }
}

interface ImportSummary {
  staff: number;
  roles: number;
  rubrics: number;
  roleYearMappings: number;
  workProductQuestions: number;
  finalizedObservations: number;
  warnings: string[];
}

async function run(args: CliArgs): Promise<ImportSummary> {
  const sheetId = requireEnv('GAS_SOURCE_SHEET_ID');
  const securityAdminEmail =
    process.env['IMPORT_SECURITY_ADMIN_EMAIL'] ?? 'paul.ivers@orono.k12.mn.us';

  console.log(`[import] target=${args.target}, sheet=${sheetId}`);
  const db: Firestore | null = args.target === 'dry-run' ? null : initFirestore(args.target);
  await ensureProdSafe(db, args);

  const summary: ImportSummary = {
    staff: 0,
    roles: 0,
    rubrics: 0,
    roleYearMappings: 0,
    workProductQuestions: 0,
    finalizedObservations: 0,
    warnings: [],
  };

  // Helpers: in dry-run mode we don't have a Firestore — the writers
  // become no-ops so we can still validate that reading + parsing works.
  async function setDocAt(path: string, data: Record<string, unknown>): Promise<void> {
    if (!db) return;
    await db.doc(path).set(data);
  }

  // 1. Discover tabs to identify role-rubric sheets (everything that isn't
  //    Staff/Settings/WorkProduct/Observation_Data is presumed a rubric tab).
  console.log('[import] Listing tabs…');
  const tabs = await listTabs(sheetId);
  const roleTabs = tabs.filter((t) => !NON_ROLE_TABS.has(t));
  console.log(`[import] Found ${String(roleTabs.length)} potential role tabs:`, roleTabs);

  // 2. Roles + rubrics — derive roles from role-tab names, parse each rubric.
  const roleNameToId = new Map<string, string>();
  for (const tabName of roleTabs) {
    const role = roleFromName(tabName);
    roleNameToId.set(tabName, role.roleId);
    console.log(`[import] Role: ${tabName} → ${role.roleId}`);
    await setDocAt(`${COLLECTIONS.roles}/${role.roleId}`, {
      ...role,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    summary.roles += 1;

    const rows = await readSheetValues(sheetId, tabName);
    const result = parseRubric({ rubricId: role.roleId, displayName: tabName, rows });
    summary.warnings.push(...result.warnings);
    console.log(
      `[import]   parsed ${String(result.rubric.domains.length)} domain(s), ` +
        `${String(result.rubric.domains.reduce((sum, d) => sum + d.components.length, 0))} component(s)`,
    );
    await setDocAt(`${COLLECTIONS.rubrics}/${role.roleId}`, {
      ...result.rubric,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    summary.rubrics += 1;
  }

  // 3. Staff
  console.log('[import] Reading Staff…');
  const staffRows = await readSheetValues(sheetId, GAS_TAB_NAMES.staff);
  const staffParsed = parseStaff(staffRows);
  summary.warnings.push(...staffParsed.warnings);
  for (const s of staffParsed.staff) {
    await setDocAt(`${COLLECTIONS.staff}/${s.email}`, {
      ...s,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      // `importedAt` signals to the onStaffWritten trigger that this doc was
      // created by the bulk importer, suppressing the staff.created invite
      // email. Without this flag a production cutover would fire an invite
      // email for every imported staff member the moment the trigger runs.
      importedAt: FieldValue.serverTimestamp(),
    });
    summary.staff += 1;
  }
  console.log(`[import] Staff: ${String(summary.staff)} rows imported`);

  // 4. Settings (role/year mappings)
  console.log('[import] Reading Settings…');
  const settingsRows = await readSheetValues(sheetId, GAS_TAB_NAMES.settings);
  const settingsParsed = parseSettings(settingsRows, roleNameToId);
  summary.warnings.push(...settingsParsed.warnings);
  for (const m of settingsParsed.mappings) {
    const docId = `${m.roleId}_${String(m.year)}`;
    await setDocAt(`${COLLECTIONS.roleYearMappings}/${docId}`, {
      ...m,
      updatedAt: FieldValue.serverTimestamp(),
    });
    summary.roleYearMappings += 1;
  }
  console.log(`[import] Role/year mappings: ${String(summary.roleYearMappings)}`);

  // 5. WorkProductQuestions
  if (tabs.includes(GAS_TAB_NAMES.workProductQuestions)) {
    console.log('[import] Reading WorkProductQuestions…');
    const wpqRows = await readSheetValues(sheetId, GAS_TAB_NAMES.workProductQuestions);
    const wpqParsed = parseWorkProductQuestions(wpqRows);
    summary.warnings.push(...wpqParsed.warnings);
    for (const q of wpqParsed.questions) {
      await setDocAt(`${COLLECTIONS.workProductQuestions}/${q.questionId}`, {
        ...q,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      summary.workProductQuestions += 1;
    }
  } else {
    summary.warnings.push('No WorkProductQuestions tab found in sheet');
  }

  // 6. Observation_Data — finalized only, as historical archive.
  if (!args.skipObservations && tabs.includes(GAS_TAB_NAMES.observationData)) {
    console.log('[import] Reading Observation_Data (finalized only)…');
    const obsRows = await readSheetValues(sheetId, GAS_TAB_NAMES.observationData);
    summary.finalizedObservations = await importFinalizedObservations(db, obsRows, summary);
  } else if (args.skipObservations) {
    summary.warnings.push('Skipped observation import (--skip-observations)');
  } else {
    summary.warnings.push('No Observation_Data tab found in sheet');
  }

  // 7. Defaults: email templates + app settings
  console.log('[import] Seeding defaults…');
  for (const tmpl of SYSTEM_TEMPLATES) {
    await setDocAt(`${COLLECTIONS.emailTemplates}/${tmpl.templateId}`, {
      ...tmpl,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
  await setDocAt(APP_SETTINGS_PATH, {
    ...defaultAppSettings(securityAdminEmail),
    updatedAt: FieldValue.serverTimestamp(),
  });

  if (args.target === 'dry-run') {
    console.log(
      '\n[import] DRY RUN — no writes were performed. The counts above show what *would* be written to Firestore.',
    );
  }

  return summary;
}

/**
 * Observation_Data is wide and dense; the GAS app stores nested state as
 * JSON-serialized strings in specific columns. Phase 2 just preserves
 * Finalized rows as historical archive — we don't try to faithfully
 * reconstruct every nested map (those are best left to the GAS PDF for
 * historical reference).
 */
async function importFinalizedObservations(
  db: Firestore | null,
  rows: string[][],
  summary: ImportSummary,
): Promise<number> {
  // Header row indicates column positions; detect dynamically.
  const header = (rows[0] ?? []).map((c) => c.trim().toLowerCase());
  const idx = (name: string) => header.indexOf(name.toLowerCase());
  const need = (name: string): number => {
    const i = idx(name);
    if (i < 0) throw new Error(`Observation_Data missing column "${name}"`);
    return i;
  };

  let observationIdCol: number;
  let observerEmailCol: number;
  let observedEmailCol: number;
  let statusCol: number;
  try {
    observationIdCol = need('observationid');
    observerEmailCol = need('observeremail');
    observedEmailCol = need('observedemail');
    statusCol = need('status');
  } catch (err) {
    summary.warnings.push(`Skipped observation import: ${(err as Error).message}`);
    return 0;
  }

  const observedNameCol = idx('observedname');
  const observedRoleCol = idx('observedrole');
  const observedYearCol = idx('observedyear');
  const observationNameCol = idx('observationname');
  const finalizedAtCol = idx('finalizedat');
  const createdAtCol = idx('createdat');
  const pdfDriveFileIdCol = idx('pdfdrivefileid');
  const driveFolderIdCol = idx('drivefolderid');

  let count = 0;
  for (let r = 1; r < rows.length; r += 1) {
    const row = rows[r];
    if (!row) continue;
    const status = (row[statusCol] ?? '').trim();
    if (status !== OBSERVATION_STATUS.finalized) continue;

    const observationId = (row[observationIdCol] ?? '').trim();
    if (!observationId) continue;

    const yearRaw = observedYearCol >= 0 ? Number((row[observedYearCol] ?? '1').trim()) : 1;
    const year = yearRaw >= 1 && yearRaw <= 6 ? yearRaw : 1;

    if (db) {
      await db
        .collection(COLLECTIONS.observations)
        .doc(observationId)
        .set({
          observationId,
          observerEmail: (row[observerEmailCol] ?? '').trim().toLowerCase(),
          observedEmail: (row[observedEmailCol] ?? '').trim().toLowerCase(),
          observedName: observedNameCol >= 0 ? (row[observedNameCol] ?? '').trim() : '',
          observedRole: slugifyRoleName(
            observedRoleCol >= 0 ? (row[observedRoleCol] ?? '').trim() || 'Teacher' : 'Teacher',
          ),
          observedYear: year,
          observedBuildings: [],
          status: OBSERVATION_STATUS.finalized,
          type: 'Standard',
          observationName: observationNameCol >= 0 ? (row[observationNameCol] ?? '').trim() : '',
          observationData: {},
          componentNotes: {},
          evidenceLinks: {},
          componentTags: [],
          workProductAnswers: [],
          audioDriveFileIds: [],
          transcripts: {},
          driveFolderId:
            driveFolderIdCol >= 0 ? (row[driveFolderIdCol] ?? '').trim() || null : null,
          pdfDriveFileId:
            pdfDriveFileIdCol >= 0 ? (row[pdfDriveFileIdCol] ?? '').trim() || null : null,
          observationDate: parseDateOrNow(row[createdAtCol] ?? ''),
          createdAt: parseDateOrNow(row[createdAtCol] ?? ''),
          lastModifiedAt: parseDateOrNow(row[finalizedAtCol] ?? ''),
          finalizedAt: parseDateOrNow(row[finalizedAtCol] ?? ''),
          _legacyImport: true,
        });
    }
    count += 1;
  }
  return count;
}

function parseDateOrNow(s: string): Date {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const summary = await run(args);
  console.log('\n=== Import complete ===');
  console.log(`Staff:                    ${String(summary.staff)}`);
  console.log(`Roles:                    ${String(summary.roles)}`);
  console.log(`Rubrics:                  ${String(summary.rubrics)}`);
  console.log(`Role/year mappings:       ${String(summary.roleYearMappings)}`);
  console.log(`Work product questions:   ${String(summary.workProductQuestions)}`);
  console.log(`Finalized observations:   ${String(summary.finalizedObservations)}`);
  if (summary.warnings.length > 0) {
    console.log(`\nWarnings (${String(summary.warnings.length)}):`);
    for (const w of summary.warnings) console.log(`  - ${w}`);
  }
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
