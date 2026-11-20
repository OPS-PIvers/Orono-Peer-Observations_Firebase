/**
 * Read-only report: who can open observation files in Drive, and is any of
 * that access more than the app means to give?
 *
 * The app only ever grants Reader, per user, to an observation's observer,
 * its co-observers and (at finalize) the observed staff member. Anything else
 * that reaches an observation folder is a leak:
 *   - Shared Drive members: membership inherits into every folder.
 *   - Direct grants on the Observations parent folder: also inherit into every
 *     observation folder.
 *   - Group, domain or "anyone" grants on any observation folder or file.
 *   - Direct user grants on a folder or file for someone who is not that
 *     observation's observer, co-observer or observed staff member.
 *
 * Writes nothing to Firestore or Drive.
 *
 * Auth (same as report:drive-ids:prod):
 *   - Firestore: application-default credentials
 *   - Drive: the observations@ uploader's refresh token from Secret Manager,
 *     so the report sees what the Functions see.
 *
 * Usage:
 *   pnpm report:drive-exposure:prod
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { google, type drive_v3 } from 'googleapis';
import { COLLECTIONS } from '@ops/shared';
import { initFirestore } from '../import/firebase.js';

loadDotenv();

const PROJECT = 'peer-evaluator-rubric';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

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

function driveClient(): drive_v3.Drive {
  const auth = new google.auth.OAuth2(
    envValue('GOOGLE_OAUTH_CLIENT_ID'),
    secret('GOOGLE_OAUTH_CLIENT_SECRET'),
  );
  auth.setCredentials({ refresh_token: secret('DRIVE_OAUTH_REFRESH_TOKEN') });
  return google.drive({ version: 'v3', auth });
}

interface Perm {
  type: string;
  role: string;
  who: string;
  inherited: boolean;
}

async function perms(drive: drive_v3.Drive, fileId: string): Promise<Perm[] | 'error'> {
  try {
    const out: Perm[] = [];
    let pageToken: string | undefined;
    do {
      const r: { data: drive_v3.Schema$PermissionList } = await drive.permissions.list({
        fileId,
        supportsAllDrives: true,
        ...(pageToken ? { pageToken } : {}),
        fields:
          'nextPageToken, permissions(type, role, emailAddress, domain, permissionDetails(inherited))',
      });
      for (const p of r.data.permissions ?? []) {
        const details = p.permissionDetails ?? [];
        out.push({
          type: p.type ?? '',
          role: p.role ?? '',
          who: (p.emailAddress ?? p.domain ?? p.type ?? '').toLowerCase(),
          // Shared Drive items report inheritance per detail; My Drive items
          // have no details, so treat them as direct.
          inherited: details.length > 0 && details.every((d) => d.inherited === true),
        });
      }
      pageToken = r.data.nextPageToken ?? undefined;
    } while (pageToken);
    return out;
  } catch (err) {
    console.log(`  permissions.list ${fileId} failed: ${(err as Error).message}`);
    return 'error';
  }
}

async function children(drive: drive_v3.Drive, folderId: string): Promise<drive_v3.Schema$File[]> {
  const out: drive_v3.Schema$File[] = [];
  let pageToken: string | undefined;
  do {
    const r: { data: drive_v3.Schema$FileList } = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      pageSize: 1000,
      ...(pageToken ? { pageToken } : {}),
      fields: 'nextPageToken, files(id, name, mimeType)',
    });
    out.push(...(r.data.files ?? []));
    pageToken = r.data.nextPageToken ?? undefined;
  } while (pageToken);
  return out;
}

function fmt(p: Perm): string {
  return `${p.type}:${p.who} (${p.role}${p.inherited ? ', inherited' : ''})`;
}

async function main(): Promise<void> {
  const parentId = envValue('DRIVE_PARENT_FOLDER_ID');
  const drive = driveClient();
  const db = initFirestore('prod');

  const staffSnap = await db.collection(COLLECTIONS.staff).get();
  const roleOf = new Map<string, string>();
  for (const d of staffSnap.docs) roleOf.set(d.id.toLowerCase(), String(d.data()['role'] ?? ''));
  const label = (email: string): string => `${email} [${roleOf.get(email) ?? 'not staff'}]`;

  // 1. Where the parent lives.
  const parent = await drive.files.get({
    fileId: parentId,
    supportsAllDrives: true,
    fields: 'id, name, driveId, parents',
  });
  const driveId = parent.data.driveId ?? null;
  console.log(`Observations parent: "${String(parent.data.name)}" driveId=${String(driveId)}`);

  // 2. Shared Drive members: these see every observation folder.
  if (driveId) {
    const sd = await drive.drives.get({ driveId, fields: 'name, restrictions' });
    console.log(
      `\nShared Drive "${String(sd.data.name)}" restrictions: ${JSON.stringify(sd.data.restrictions)}`,
    );
    const members = await perms(drive, driveId);
    console.log('Shared Drive members (each can open EVERY observation folder):');
    if (members !== 'error')
      for (const m of members) console.log(`  ${fmt(m)}  ${m.type === 'user' ? label(m.who) : ''}`);
  }

  // 3. Grants on the parent folder itself (also inherit into every folder).
  const parentPerms = await perms(drive, parentId);
  console.log(
    '\nGrants on the Observations parent folder (direct ones inherit into every folder):',
  );
  if (parentPerms !== 'error') for (const p of parentPerms) console.log(`  ${fmt(p)}`);

  // 4. Every observation folder and file vs. who the app means to grant.
  const obsSnap = await db.collection(COLLECTIONS.observations).get();
  const expectedByFolder = new Map<string, { id: string; allowed: Set<string> }>();
  for (const doc of obsSnap.docs) {
    const d = doc.data();
    const folderId = typeof d['driveFolderId'] === 'string' ? d['driveFolderId'] : '';
    if (!folderId) continue;
    const allowed = new Set<string>(
      [
        d['observerEmail'],
        d['observedEmail'],
        ...(Array.isArray(d['coObserverEmails']) ? (d['coObserverEmails'] as unknown[]) : []),
      ]
        .filter((e): e is string => typeof e === 'string')
        .map((e) => e.toLowerCase()),
    );
    expectedByFolder.set(folderId, { id: doc.id, allowed });
  }

  const folders = (await children(drive, parentId)).filter((f) => f.mimeType === FOLDER_MIME);
  let files = 0;
  let unexpected = 0;
  let broad = 0;
  const unexpectedPeople = new Map<string, number>();
  console.log(`\nObservation folders under the parent: ${String(folders.length)}`);
  for (const folder of folders) {
    const exp = expectedByFolder.get(folder.id ?? '');
    const items = [folder, ...(await children(drive, folder.id ?? ''))];
    files += items.length - 1;
    for (const item of items) {
      const ps = await perms(drive, item.id ?? '');
      if (ps === 'error') continue;
      for (const p of ps) {
        if (p.inherited || p.role === 'owner' || p.role === 'organizer') continue;
        if (p.type !== 'user') {
          broad++;
          console.log(`  BROAD ${fmt(p)} on "${String(item.name)}" (obs ${exp?.id ?? 'unknown'})`);
          continue;
        }
        if (exp?.allowed.has(p.who)) continue;
        unexpected++;
        unexpectedPeople.set(p.who, (unexpectedPeople.get(p.who) ?? 0) + 1);
        console.log(
          `  EXTRA ${fmt(p)} ${label(p.who)} on "${String(item.name)}" (obs ${exp?.id ?? 'no observation points here'})`,
        );
      }
    }
  }
  console.log('\nPeople with direct grants outside their observations:');
  for (const [who, n] of unexpectedPeople) console.log(`  ${label(who)}: ${String(n)} items`);
  console.log(
    `\nfolders: ${String(folders.length)} | files: ${String(files)} | extra user grants: ${String(unexpected)} | group/domain/anyone grants: ${String(broad)} | observations with a folder in Firestore: ${String(expectedByFolder.size)}`,
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
