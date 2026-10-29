/**
 * Read-only report: which observations point at Drive objects outside the
 * observations parent folder (DRIVE_PARENT_FOLDER_ID)?
 *
 * The Functions only act on an observation's folder when it is a direct child
 * of the parent, and on files inside that folder. Observations imported from
 * the Apps Script app can carry folder ids from elsewhere; this lists them,
 * grouped by the folder their folder sits in, with what they hold, so those
 * parents can be allowlisted or the folders moved.
 *
 * Writes nothing to Firestore or Drive.
 *
 * Auth:
 *   - Firestore: application-default credentials
 *   - Drive: the observations@ uploader's refresh token from Secret Manager
 *     (`gcloud secrets versions access`, as drive:migrate does), so the
 *     report sees what the Functions see.
 *
 * Usage:
 *   pnpm report:drive-ids:prod
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { google, type drive_v3 } from 'googleapis';
import { COLLECTIONS } from '@ops/shared';
import { initFirestore } from '../import/firebase.js';

loadDotenv();

const FOLDER_MIME = 'application/vnd.google-apps.folder';

const PROJECT = 'peer-evaluator-rubric';

function envValue(key: string): string {
  const line = readFileSync(resolve(`apps/functions/.env.${PROJECT}`), 'utf8')
    .split(/\r?\n/)
    .find((l) => l.startsWith(`${key}=`));
  const value = line?.slice(key.length + 1).trim();
  if (!value) throw new Error(`${key} is not set in apps/functions/.env.${PROJECT}`);
  return value;
}

function secret(name: string): string {
  const r = spawnSync(
    'gcloud',
    ['secrets', 'versions', 'access', 'latest', `--secret=${name}`, `--project=${PROJECT}`],
    { encoding: 'utf8', shell: process.platform === 'win32' },
  );
  if (r.status !== 0) throw new Error(`gcloud secrets access ${name} failed: ${r.stderr}`);
  return r.stdout.trim();
}

/** Drive as the observations@ uploader, the account the Functions use, so
 *  the report sees exactly what they see. Reads only. */
function driveClient(): drive_v3.Drive {
  const auth = new google.auth.OAuth2(
    envValue('GOOGLE_OAUTH_CLIENT_ID'),
    secret('GOOGLE_OAUTH_CLIENT_SECRET'),
  );
  auth.setCredentials({ refresh_token: secret('DRIVE_OAUTH_REFRESH_TOKEN') });
  return google.drive({ version: 'v3', auth });
}

type Meta =
  { parents: string[]; mimeType: string; trashed: boolean; name: string } | 'missing' | 'error';

async function meta(drive: drive_v3.Drive, fileId: string): Promise<Meta> {
  try {
    const r = await drive.files.get({
      fileId,
      fields: 'parents, mimeType, trashed, name',
      supportsAllDrives: true,
    });
    return {
      parents: r.data.parents ?? [],
      mimeType: r.data.mimeType ?? '',
      trashed: r.data.trashed ?? false,
      name: r.data.name ?? '',
    };
  } catch (err) {
    const code = Number((err as { code?: unknown }).code);
    return code === 404 ? 'missing' : 'error';
  }
}

function evidenceIds(raw: unknown): string[] {
  if (!raw || typeof raw !== 'object') return [];
  return Object.values(raw as Record<string, unknown>).flatMap((list) =>
    Array.isArray(list)
      ? list
          .map((f) => (f as { driveFileId?: unknown }).driveFileId)
          .filter((id): id is string => typeof id === 'string' && id !== '')
      : [],
  );
}

async function main(): Promise<void> {
  const parent = envValue('DRIVE_PARENT_FOLDER_ID');
  const db = initFirestore('prod');
  const drive = driveClient();
  const snap = await db.collection(COLLECTIONS.observations).get();

  const counts = { noFolder: 0, ok: 0, outside: 0, missing: 0, trashed: 0, error: 0 };
  // Files in a good folder but not inside it (would be refused or skipped).
  let strayFiles = 0;
  const byLegacyParent = new Map<string, string[]>();

  for (const doc of snap.docs) {
    const d = doc.data();
    const folderId = typeof d['driveFolderId'] === 'string' ? d['driveFolderId'] : '';
    const pdf = typeof d['pdfDriveFileId'] === 'string' ? d['pdfDriveFileId'] : '';
    const audio = Array.isArray(d['audioDriveFileIds'])
      ? (d['audioDriveFileIds'] as unknown[]).filter((x): x is string => typeof x === 'string')
      : [];
    const evidence = evidenceIds(d['evidenceLinks']);
    const status = String(d['status'] ?? '');
    const summary = `${doc.id} [${status}] pdf:${pdf ? 'y' : 'n'} audio:${String(audio.length)} evidence:${String(evidence.length)}`;

    if (!folderId) {
      counts.noFolder++;
      if (pdf || audio.length || evidence.length) {
        strayFiles++;
        console.log(`no folder but has files: ${summary}`);
      }
      continue;
    }
    const m = await meta(drive, folderId);
    if (m === 'missing' || m === 'error') {
      counts[m]++;
      console.log(`folder ${m}: ${summary} folder=${folderId}`);
      continue;
    }
    if (m.trashed) {
      counts.trashed++;
      console.log(`folder trashed: ${summary}`);
      continue;
    }
    if (m.mimeType !== FOLDER_MIME || !m.parents.includes(parent)) {
      counts.outside++;
      const key =
        m.mimeType !== FOLDER_MIME
          ? `(not a folder: ${m.mimeType})`
          : m.parents.join(',') || '(no parents)';
      // The Functions still accept a folder named for this observation.
      const named = m.mimeType === FOLDER_MIME && m.name.endsWith(` — ${doc.id}`);
      byLegacyParent.set(key, [
        ...(byLegacyParent.get(key) ?? []),
        `${summary} name-ok:${named ? 'y' : 'N (would get a fresh folder)'}`,
      ]);
      continue;
    }
    counts.ok++;
    for (const id of [pdf, ...audio, ...evidence].filter(Boolean)) {
      const f = await meta(drive, id);
      if (f !== 'missing' && f !== 'error' && !f.parents.includes(folderId)) {
        strayFiles++;
        console.log(
          `file outside its folder: ${summary} file=${id} parents=${f.parents.join(',')}`,
        );
      }
    }
  }

  console.log('\nFolders outside the parent, grouped by where they sit:');
  for (const [where, list] of byLegacyParent) {
    console.log(`  in ${where}: ${String(list.length)}`);
    for (const s of list) console.log(`    ${s}`);
  }
  console.log(
    `\nobservations: ${String(snap.size)} | folder under parent: ${String(counts.ok)} | outside parent: ${String(counts.outside)} | no folder: ${String(counts.noFolder)} | folder missing: ${String(counts.missing)} | trashed: ${String(counts.trashed)} | lookup errors: ${String(counts.error)} | stray files: ${String(strayFiles)}`,
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
