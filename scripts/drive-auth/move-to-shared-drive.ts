/**
 * Move observation Drive folders from the My Drive parent folder into the
 * district Shared Drive (docs/DRIVE_ACCESS_PLAN.md, phase 5).
 *
 * Drive refuses to move a *folder* from My Drive into a Shared Drive, so each
 * observation folder is recreated in the Shared Drive instead: a new folder
 * with the same name and direct shares, the files moved into it (file moves
 * are allowed and keep their IDs, so `pdfDriveFileId`, evidence/audio IDs and
 * emailed PDF links keep working), then the observation's `driveFolderId` is
 * repointed and the emptied old folder trashed. Old *folder* links stop
 * resolving; the app always builds folder links from `driveFolderId`.
 *
 * Acts as the Drive uploader (DRIVE_OAUTH_REFRESH_TOKEN, latest version),
 * which must be a Manager of the Shared Drive. Items it doesn't own (e.g.
 * folders the service account created before PR #110) are reported and
 * skipped. The Master Log Sheet is left in place, but the service account
 * that writes it gets a direct Editor grant so it doesn't depend on the old
 * parent folder.
 *
 * Usage:
 *   pnpm drive:migrate -- --drive=<sharedDriveId> --from=<oldParentId>          # dry run
 *   pnpm drive:migrate -- --drive=<sharedDriveId> --from=<oldParentId> --apply
 *
 * Creates `Observations` and `Modules` at the Shared Drive root if missing and
 * prints their IDs for DRIVE_PARENT_FOLDER_ID / DRIVE_MODULES_FOLDER_ID.
 * Safe to re-run: already-moved items are no longer in the old parent.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import type { Firestore } from 'firebase-admin/firestore';
import { google, type drive_v3 } from 'googleapis';
import { COLLECTIONS } from '@ops/shared';
import { initFirestore } from '../import/firebase.js';

loadDotenv();

const PROJECT = 'peer-evaluator-rubric';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const SERVICE_ACCOUNT = `peer-eval-svc@${PROJECT}.iam.gserviceaccount.com`;

function arg(name: string): string | null {
  return (
    process.argv
      .slice(2)
      .find((a) => a.startsWith(`--${name}=`))
      ?.slice(name.length + 3) ?? null
  );
}

function gcloud(args: string[]): string {
  const r = spawnSync('gcloud', args, { encoding: 'utf8', shell: process.platform === 'win32' });
  if (r.status !== 0) throw new Error(`gcloud ${args[0] ?? ''} failed: ${r.stderr}`);
  return r.stdout.trim();
}

function readEnvValue(key: string): string {
  const line = readFileSync(resolve('apps/functions', `.env.${PROJECT}`), 'utf8')
    .split(/\r?\n/)
    .find((l) => l.startsWith(`${key}=`));
  const value = line?.slice(key.length + 1).trim();
  if (!value) throw new Error(`${key} is not set in apps/functions/.env.${PROJECT}`);
  return value;
}

function secret(name: string): string {
  return gcloud([
    'secrets',
    'versions',
    'access',
    'latest',
    `--secret=${name}`,
    `--project=${PROJECT}`,
  ]);
}

async function uploaderDrive(): Promise<{ drive: drive_v3.Drive; email: string }> {
  const auth = new google.auth.OAuth2(
    readEnvValue('GOOGLE_OAUTH_CLIENT_ID'),
    secret('GOOGLE_OAUTH_CLIENT_SECRET'),
  );
  auth.setCredentials({ refresh_token: secret('DRIVE_OAUTH_REFRESH_TOKEN') });
  const drive = google.drive({ version: 'v3', auth });
  const about = await drive.about.get({ fields: 'user(emailAddress)' });
  return { drive, email: about.data.user?.emailAddress?.toLowerCase() ?? '' };
}

async function listChildren(drive: drive_v3.Drive, folderId: string) {
  const out: drive_v3.Schema$File[] = [];
  let pageToken: string | undefined;
  do {
    const res: { data: drive_v3.Schema$FileList } = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'nextPageToken, files(id,name,mimeType,owners(emailAddress))',
      pageSize: 1000,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      ...(pageToken ? { pageToken } : {}),
    });
    out.push(...(res.data.files ?? []));
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
  return out;
}

async function ensureRootFolder(
  drive: drive_v3.Drive,
  driveId: string,
  name: string,
  apply: boolean,
): Promise<string | null> {
  const existing = await drive.files.list({
    q: `'${driveId}' in parents and name = '${name}' and mimeType = '${FOLDER_MIME}' and trashed = false`,
    fields: 'files(id)',
    corpora: 'drive',
    driveId,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  const found = existing.data.files?.[0]?.id;
  if (found) return found;
  if (!apply) return null;
  const created = await drive.files.create({
    requestBody: { name, mimeType: FOLDER_MIME, parents: [driveId] },
    fields: 'id',
    supportsAllDrives: true,
  });
  return created.data.id ?? null;
}

async function moveItem(
  drive: drive_v3.Drive,
  item: drive_v3.Schema$File,
  fromId: string,
  toId: string | null,
  apply: boolean,
): Promise<boolean> {
  const tag = apply ? '' : '[dry-run] ';
  console.log(`${tag}move ${item.name ?? item.id ?? ''}`);
  if (!apply || !toId || !item.id) return true;
  try {
    await drive.files.update({
      fileId: item.id,
      addParents: toId,
      removeParents: fromId,
      supportsAllDrives: true,
      fields: 'id',
    });
    return true;
  } catch (err) {
    console.error(`  failed: ${(err as Error).message}`);
    return false;
  }
}

/**
 * Recreate one observation folder in the Shared Drive. Idempotent: the new
 * folder is tagged with the source folder's ID, so a re-run reuses it and
 * just moves whatever is still left in the old folder.
 */
async function recreateFolder(
  drive: drive_v3.Drive,
  db: Firestore,
  item: drive_v3.Schema$File,
  targetParent: string,
  uploader: string,
  apply: boolean,
): Promise<boolean> {
  const tag = apply ? '' : '[dry-run] ';
  const sourceId = item.id ?? '';
  const obsSnap = await db
    .collection(COLLECTIONS.observations)
    .where('driveFolderId', '==', sourceId)
    .get();
  const files = await listChildren(drive, sourceId);
  const perms = await drive.permissions.list({
    fileId: sourceId,
    fields: 'permissions(type,role,emailAddress,domain,permissionDetails(inherited))',
  });
  // Direct shares only: the owner and anything inherited from the old parent
  // don't carry over. The service account can't be shared inside an
  // Orono-only Shared Drive, and the app doesn't need it on folders.
  const shares = (perms.data.permissions ?? []).filter(
    (p) =>
      p.role !== 'owner' &&
      p.emailAddress?.toLowerCase() !== uploader &&
      p.emailAddress?.toLowerCase() !== SERVICE_ACCOUNT &&
      p.permissionDetails?.some((d) => !d.inherited),
  );
  console.log(
    `${tag}recreate ${item.name ?? sourceId}: ${String(files.length)} files, shares [${shares
      .map((p) => `${p.emailAddress ?? p.domain ?? p.type ?? ''}:${p.role ?? ''}`)
      .join(', ')}], observations [${obsSnap.docs.map((d) => d.id).join(', ') || 'none'}]`,
  );
  if (!apply) return true;

  try {
    const existing = await drive.files.list({
      q: `'${targetParent}' in parents and trashed = false and appProperties has { key='sourceFolderId' and value='${sourceId}' }`,
      fields: 'files(id)',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    let newId = existing.data.files?.[0]?.id ?? null;
    if (!newId) {
      const created = await drive.files.create({
        requestBody: {
          name: item.name ?? sourceId,
          mimeType: FOLDER_MIME,
          parents: [targetParent],
          appProperties: { sourceFolderId: sourceId },
        },
        fields: 'id',
        supportsAllDrives: true,
      });
      newId = created.data.id ?? null;
    }
    if (!newId) throw new Error('folder creation returned no id');

    for (const p of shares) {
      await drive.permissions.create({
        fileId: newId,
        sendNotificationEmail: false,
        supportsAllDrives: true,
        requestBody:
          p.type === 'domain'
            ? { type: 'domain', role: p.role ?? 'reader', domain: p.domain ?? '' }
            : {
                type: p.type ?? 'user',
                role: p.role ?? 'reader',
                emailAddress: p.emailAddress ?? '',
              },
      });
    }
    for (const f of files) {
      if (!f.id) continue;
      await drive.files.update({
        fileId: f.id,
        addParents: newId,
        removeParents: sourceId,
        supportsAllDrives: true,
        fields: 'id',
      });
    }
    for (const doc of obsSnap.docs) {
      await doc.ref.update({ driveFolderId: newId });
    }
    if ((await listChildren(drive, sourceId)).length === 0) {
      await drive.files.update({ fileId: sourceId, requestBody: { trashed: true } });
    }
    console.log(`  → ${newId}`);
    return true;
  } catch (err) {
    console.error(`  failed: ${(err as Error).message}`);
    return false;
  }
}

async function main(): Promise<void> {
  const driveId = arg('drive');
  const apply = process.argv.includes('--apply');
  if (!driveId) throw new Error('Usage: --drive=<sharedDriveId> [--apply]');

  const { drive, email } = await uploaderDrive();
  const db = initFirestore('prod');
  // The old My Drive parent. After the cutover DRIVE_PARENT_FOLDER_ID points
  // at the Shared Drive, so pass the old folder explicitly with --from.
  const oldParent = arg('from') ?? readEnvValue('DRIVE_PARENT_FOLDER_ID');
  const masterLog = readEnvValue('MASTER_LOG_SHEET_ID');
  console.log(`${apply ? '' : '[dry-run] '}acting as ${email}; source folder ${oldParent}`);

  const observationsId = await ensureRootFolder(drive, driveId, 'Observations', apply);
  if (oldParent === observationsId) {
    throw new Error(
      'Source is already the Shared Drive Observations folder; pass --from=<old folder id>.',
    );
  }
  const modulesId = await ensureRootFolder(drive, driveId, 'Modules', apply);

  const children = await listChildren(drive, oldParent);
  let moved = 0;
  let failed = 0;
  const skipped: string[] = [];

  for (const item of children) {
    const owner = item.owners?.[0]?.emailAddress?.toLowerCase();
    if (item.id === masterLog) {
      // The service account writes this Sheet. Give it a direct grant so it
      // no longer relies on inheriting access from the old parent folder.
      const perms = await drive.permissions.list({
        fileId: masterLog,
        fields: 'permissions(emailAddress,permissionDetails(inherited))',
      });
      const direct = perms.data.permissions?.some(
        (p) =>
          p.emailAddress?.toLowerCase() === SERVICE_ACCOUNT &&
          p.permissionDetails?.some((d) => !d.inherited),
      );
      console.log(
        direct
          ? 'Master Log: service account already has direct access; left in place'
          : `${apply ? '' : '[dry-run] '}Master Log: grant ${SERVICE_ACCOUNT} direct Editor; left in place`,
      );
      if (apply && !direct) {
        await drive.permissions.create({
          fileId: masterLog,
          sendNotificationEmail: false,
          requestBody: { type: 'user', role: 'writer', emailAddress: SERVICE_ACCOUNT },
        });
      }
      continue;
    }
    if (owner && owner !== email) {
      skipped.push(`${item.name ?? ''} (${item.id ?? ''}), owned by ${owner}`);
      continue;
    }
    if (item.mimeType === FOLDER_MIME && item.name === 'Modules') {
      // Module resources go to the Shared Drive's Modules folder, not into
      // the restricted observations tree.
      for (const file of await listChildren(drive, item.id ?? '')) {
        if (await moveItem(drive, file, item.id ?? '', modulesId, apply)) moved++;
        else failed++;
      }
      continue;
    }
    const ok =
      item.mimeType === FOLDER_MIME
        ? observationsId !== null &&
          (await recreateFolder(drive, db, item, observationsId, email, apply))
        : await moveItem(drive, item, oldParent, observationsId, apply);
    if (ok || !apply) moved++;
    else failed++;
  }

  console.log(
    `\n${apply ? 'moved' : 'would move'} ${String(moved)}, failed ${String(failed)}, skipped ${String(skipped.length)}`,
  );
  for (const s of skipped) console.log(`  skipped (not owned by ${email}): ${s}`);
  console.log(`\nObservations folder: ${observationsId ?? '(created on --apply)'}`);
  console.log(`Modules folder:      ${modulesId ?? '(created on --apply)'}`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error('[drive-migrate]', err instanceof Error ? err.message : err);
  process.exit(1);
});
