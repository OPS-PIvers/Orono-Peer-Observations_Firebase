/**
 * Firestore → JSON/CSV export — backup / district-reporting / year-end
 * archival tooling.
 *
 * Reads current Firestore data (staff, observations, rubrics, auditLog by
 * default) and writes it to a local output directory as one JSON file per
 * collection, plus a CSV for staff (mirroring the roster CSV shape used by
 * StaffPage's "Export CSV" so the two are directly comparable/diffable).
 * This is a read-only script — it never writes to Firestore.
 *
 * Targets:
 *   --target=emulator     reads from Firestore emulator on 127.0.0.1:8080
 *   --target=prod         reads from live Firestore (peer-evaluator-rubric)
 *
 * Auth (prod target) — same as scripts/import:
 *   - gcloud auth application-default login   (recommended for one-shot
 *     interactive runs by Paul)
 *   - OR set GOOGLE_APPLICATION_CREDENTIALS to a JSON key path
 *
 * Usage:
 *   pnpm export:emulator
 *   pnpm export:prod
 *   tsx scripts/export/export.ts --target=prod --collections=staff,rubrics
 *   tsx scripts/export/export.ts --target=prod --out=./exports/2026-06-30
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import type { Firestore } from 'firebase-admin/firestore';
import { Timestamp } from 'firebase-admin/firestore';
import { COLLECTIONS, type ModuleDoc, type Role, type Staff } from '@ops/shared';
import { initFirestore, type ImportTarget } from '../import/firebase.js';
import { csvSerializeDocument } from './csv.js';

loadDotenv();

/** Collections this script knows how to export, and the CLI name used to
 *  select them via --collections=. Keep in sync with the "Key files" list
 *  in docs/FEATURE_AUDIT.md finding #18. */
const EXPORTABLE_COLLECTIONS = {
  staff: COLLECTIONS.staff,
  observations: COLLECTIONS.observations,
  rubrics: COLLECTIONS.rubrics,
  auditLog: COLLECTIONS.auditLog,
} as const;
type ExportCollectionName = keyof typeof EXPORTABLE_COLLECTIONS;
const ALL_COLLECTION_NAMES = Object.keys(EXPORTABLE_COLLECTIONS) as ExportCollectionName[];

interface CliArgs {
  target: ImportTarget;
  collections: ExportCollectionName[];
  outDir: string;
}

function parseArgs(argv: string[]): CliArgs {
  const target = argv.find((a) => a.startsWith('--target='))?.split('=')[1];
  if (target !== 'emulator' && target !== 'prod') {
    throw new Error(
      'Usage: --target=emulator|prod [--collections=staff,observations,rubrics,auditLog] [--out=<dir>]',
    );
  }

  const collectionsArg = argv.find((a) => a.startsWith('--collections='))?.split('=')[1];
  let collections: ExportCollectionName[] = ALL_COLLECTION_NAMES;
  if (collectionsArg) {
    const requested = collectionsArg.split(',').map((c) => c.trim());
    const invalid = requested.filter(
      (c) => !ALL_COLLECTION_NAMES.includes(c as ExportCollectionName),
    );
    if (invalid.length > 0) {
      throw new Error(
        `Unknown collection(s): ${invalid.join(', ')}. Valid: ${ALL_COLLECTION_NAMES.join(', ')}`,
      );
    }
    collections = requested as ExportCollectionName[];
  }

  const outArg = argv.find((a) => a.startsWith('--out='))?.split('=')[1];
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = outArg ?? join('exports', `${target}-${timestamp}`);

  return { target, collections, outDir };
}

/**
 * Deep-convert Firestore Timestamps (and anything else admin SDK hands
 * back — DocumentReference isn't expected in these collections, but plain
 * objects/arrays are recursed) into JSON-safe values. Timestamps become
 * ISO 8601 strings.
 */
function toJsonSafe(value: unknown): unknown {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(toJsonSafe);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = toJsonSafe(v);
    }
    return out;
  }
  return value;
}

async function fetchCollection(
  db: Firestore,
  collectionName: string,
): Promise<Record<string, unknown>[]> {
  const snap = await db.collection(collectionName).get();
  return snap.docs.map((doc) => ({
    id: doc.id,
    ...(toJsonSafe(doc.data()) as Record<string, unknown>),
  }));
}

function writeJson(outDir: string, name: string, data: unknown): void {
  const path = join(outDir, `${name}.json`);
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log(`[export]   wrote ${path}`);
}

/** Column order matches STAFF_CSV_COLUMNS in
 *  apps/web/src/admin/staff/staffCsv.ts so a file downloaded from the admin
 *  UI and one produced by this script are directly comparable. */
const STAFF_CSV_COLUMNS = [
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
const LIST_SEPARATOR = '; ';

function formatCsvDate(value: unknown): string {
  if (typeof value !== 'string') return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

function writeStaffCsv(
  outDir: string,
  staffDocs: readonly (Staff & { id: string })[],
  roles: readonly Role[],
  modules: readonly ModuleDoc[],
): void {
  const roleLabel = new Map(roles.map((r) => [r.roleId, r.displayName]));
  const moduleLabel = new Map(modules.map((m) => [m.moduleId, m.displayName]));

  const rows = staffDocs.map((s) => [
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
  ]);

  const csv = csvSerializeDocument(STAFF_CSV_COLUMNS, rows);
  const path = join(outDir, 'staff.csv');
  writeFileSync(path, csv, 'utf8');
  console.log(`[export]   wrote ${path}`);
}

interface ExportSummary {
  target: ImportTarget;
  outDir: string;
  exportedAt: string;
  counts: Partial<Record<ExportCollectionName, number>>;
}

async function run(args: CliArgs): Promise<ExportSummary> {
  console.log(`[export] target=${args.target}, collections=${args.collections.join(',')}`);
  mkdirSync(args.outDir, { recursive: true });

  const db = initFirestore(args.target);

  const summary: ExportSummary = {
    target: args.target,
    outDir: args.outDir,
    exportedAt: new Date().toISOString(),
    counts: {},
  };

  // Cache staff docs (and reference collections) so the CSV export can
  // reuse the JSON fetch instead of reading /staff twice.
  let staffDocs: (Staff & { id: string })[] | null = null;

  for (const name of args.collections) {
    console.log(`[export] Reading /${EXPORTABLE_COLLECTIONS[name]}…`);
    const docs = await fetchCollection(db, EXPORTABLE_COLLECTIONS[name]);
    writeJson(args.outDir, name, docs);
    summary.counts[name] = docs.length;
    if (name === 'staff') staffDocs = docs as (Staff & { id: string })[];
  }

  if (staffDocs) {
    console.log('[export] Reading /roles and /modules for staff.csv display names…');
    const [rolesDocs, modulesDocs] = await Promise.all([
      fetchCollection(db, COLLECTIONS.roles),
      fetchCollection(db, COLLECTIONS.modules),
    ]);
    writeStaffCsv(
      args.outDir,
      staffDocs,
      rolesDocs as unknown as Role[],
      modulesDocs as unknown as ModuleDoc[],
    );
  }

  writeJson(args.outDir, 'manifest', summary);

  return summary;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const summary = await run(args);
  console.log('\n=== Export complete ===');
  console.log(`Output directory: ${summary.outDir}`);
  for (const [name, count] of Object.entries(summary.counts)) {
    console.log(`${name.padEnd(14)}: ${String(count)}`);
  }
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
