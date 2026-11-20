/**
 * One-time cleanup: stop Shared Drive membership from opening every
 * observation folder.
 *
 * Shared Drive members inherit access to every folder in the drive, so a Peer
 * Evaluator who is a member can open every other evaluator's observations.
 * The app never needs that: it grants Reader per folder to each observation's
 * observer, co-observers and (once finalized) observed staff member, acting as
 * observations@, the drive's Manager.
 *
 * Steps, in order:
 *   1. Give every observation's observer and co-observers (and, once
 *      finalized, the observed staff member) a DIRECT Reader on its folder, so
 *      their in-app links keep working after step 2. Existing direct grants
 *      are skipped; inherited membership doesn't count.
 *   2. Remove every Shared Drive member except Managers (organizer role) and
 *      observations@. Members are listed first; nothing else is touched.
 *   3. Retry any step-1 grant Drive refused while the person was still a
 *      member.
 *   4. Turn on "only managers can share folders", so content managers can't
 *      reshare. observations@ is a Manager, so the app's own grants still work.
 *
 * Dry run by default: prints every change it would make and makes none.
 * `--apply` makes them. Firestore is only read.
 *
 * Auth: Firestore with application-default credentials; Drive as
 * observations@ via the refresh token in Secret Manager (same as
 * report:drive-exposure:prod).
 *
 * Usage:
 *   pnpm drive:lock-members            # dry run
 *   pnpm drive:lock-members -- --apply
 *   pnpm drive:lock-members -- --keep=owner@orono.k12.mn.us [--apply]
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { google, type drive_v3 } from 'googleapis';
import { COLLECTIONS, OBSERVATION_STATUS } from '@ops/shared';
import { initFirestore } from '../import/firebase.js';

loadDotenv();

const PROJECT = 'peer-evaluator-rubric';
const UPLOADER = 'observations@orono.k12.mn.us';
const APPLY = process.argv.includes('--apply');
/** `--keep=a@x,b@x`: members to leave in place, such as a district owner. */
const KEEP = new Set(
  process.argv
    .filter((a) => a.startsWith('--keep='))
    .flatMap((a) => a.slice('--keep='.length).split(','))
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e !== ''),
);

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

function isDirect(p: drive_v3.Schema$Permission): boolean {
  const details = p.permissionDetails ?? [];
  return details.length === 0 || details.some((d) => d.inherited !== true);
}

async function listPerms(
  drive: drive_v3.Drive,
  fileId: string,
): Promise<drive_v3.Schema$Permission[]> {
  const out: drive_v3.Schema$Permission[] = [];
  let pageToken: string | undefined;
  do {
    const r: { data: drive_v3.Schema$PermissionList } = await drive.permissions.list({
      fileId,
      supportsAllDrives: true,
      ...(pageToken ? { pageToken } : {}),
      fields:
        'nextPageToken, permissions(id, type, role, emailAddress, domain, permissionDetails(inherited))',
    });
    out.push(...(r.data.permissions ?? []));
    pageToken = r.data.nextPageToken ?? undefined;
  } while (pageToken);
  return out;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

interface Grant {
  observationId: string;
  folderId: string;
  email: string;
}

async function grant(drive: drive_v3.Drive, g: Grant): Promise<void> {
  await drive.permissions.create({
    fileId: g.folderId,
    sendNotificationEmail: false,
    supportsAllDrives: true,
    requestBody: { type: 'user', role: 'reader', emailAddress: g.email },
  });
}

async function main(): Promise<void> {
  console.log(
    APPLY ? 'APPLYING changes.' : 'Dry run: no changes will be made. Pass --apply to make them.',
  );
  const parentId = envValue('DRIVE_PARENT_FOLDER_ID');
  const drive = driveClient();
  const db = initFirestore('prod');

  const parent = await drive.files.get({
    fileId: parentId,
    supportsAllDrives: true,
    fields: 'driveId',
  });
  const driveId = parent.data.driveId;
  if (!driveId) throw new Error('The Observations parent folder is not on a Shared Drive.');

  // Step 1: direct Reader for everyone the app means to have access.
  const needed: Grant[] = [];
  const obsSnap = await db.collection(COLLECTIONS.observations).get();
  for (const doc of obsSnap.docs) {
    const d = doc.data();
    const folderId = typeof d['driveFolderId'] === 'string' ? d['driveFolderId'] : '';
    if (!folderId) continue;
    const people: unknown[] = [
      d['observerEmail'],
      ...(Array.isArray(d['coObserverEmails']) ? (d['coObserverEmails'] as unknown[]) : []),
      ...(d['status'] === OBSERVATION_STATUS.finalized ? [d['observedEmail'] as unknown] : []),
    ];
    const emails = people
      .filter((e): e is string => typeof e === 'string' && e.trim() !== '')
      .map((e) => e.trim().toLowerCase());
    let perms: drive_v3.Schema$Permission[];
    try {
      perms = await listPerms(drive, folderId);
    } catch (err) {
      console.log(`  skip ${doc.id}: can't read folder ${folderId} (${errMsg(err)})`);
      continue;
    }
    const direct = new Set(perms.filter(isDirect).map((p) => (p.emailAddress ?? '').toLowerCase()));
    for (const email of new Set(emails)) {
      if (email === UPLOADER || direct.has(email)) continue;
      needed.push({ observationId: doc.id, folderId, email });
    }
  }
  console.log(`\nStep 1: direct Reader grants to add: ${String(needed.length)}`);
  for (const g of needed) console.log(`  ${g.email} on ${g.observationId}`);
  const retry: Grant[] = [];
  if (APPLY) {
    for (const g of needed) {
      try {
        await grant(drive, g);
      } catch (err) {
        console.log(`  deferred ${g.email} on ${g.observationId}: ${errMsg(err)}`);
        retry.push(g);
      }
    }
  }

  // Step 2: remove members other than Managers and observations@.
  const members = await listPerms(drive, driveId);
  const remove = members.filter(
    (m) =>
      m.role !== 'organizer' &&
      (m.emailAddress ?? '').toLowerCase() !== UPLOADER &&
      !KEEP.has((m.emailAddress ?? '').toLowerCase()),
  );
  console.log('\nStep 2: Shared Drive members');
  for (const m of members) {
    const who = m.emailAddress ?? m.domain ?? m.type ?? '?';
    console.log(
      `  ${remove.includes(m) ? 'REMOVE' : 'keep  '} ${String(m.type)}:${who} (${String(m.role)})`,
    );
  }
  if (APPLY) {
    for (const m of remove) {
      await drive.permissions.delete({
        fileId: driveId,
        permissionId: m.id ?? '',
        supportsAllDrives: true,
      });
    }
  }

  // Step 3: grants Drive refused while the person was still a member.
  if (APPLY && retry.length > 0) {
    console.log(`\nStep 3: retrying ${String(retry.length)} grants`);
    for (const g of retry) {
      try {
        await grant(drive, g);
      } catch (err) {
        console.log(`  FAILED ${g.email} on ${g.observationId}: ${errMsg(err)}`);
      }
    }
  }

  // Step 4: only Managers may share folders.
  const sd = await drive.drives.get({ driveId, fields: 'name, restrictions' });
  const already = sd.data.restrictions?.sharingFoldersRequiresOrganizerPermission === true;
  console.log(
    `\nStep 4: "only managers can share folders" on "${String(sd.data.name)}": ${already ? 'already on' : 'turn on'}`,
  );
  if (APPLY && !already) {
    await drive.drives.update({
      driveId,
      requestBody: { restrictions: { sharingFoldersRequiresOrganizerPermission: true } },
    });
  }
  console.log(
    APPLY ? '\nDone. Re-run pnpm report:drive-exposure:prod to confirm.' : '\nDry run complete.',
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
