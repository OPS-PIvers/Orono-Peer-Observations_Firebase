/**
 * Move the observations Drive tree off a person's account: transfer ownership
 * of everything under DRIVE_PARENT_FOLDER_ID to a new owner (the
 * observations@ mailbox) and then remove the old owner's access, so observers
 * opening a PDF no longer see a developer as its owner.
 *
 * Stopgap until the tree moves to a Shared Drive. Every phase acts through a
 * DRIVE_OAUTH_REFRESH_TOKEN secret version and checks which account that
 * token belongs to before doing anything.
 *
 * Order (each phase is dry-run unless --confirm):
 *   1. grant     (token = old owner, i.e. the current latest version)
 *                give the new owner Writer on the parent folder so
 *                `pnpm drive:authorize` accepts them
 *   2. pnpm drive:authorize -- --login-hint=<new owner>, then redeploy
 *      functions so uploads run as the new owner
 *   3. transfer  --version=<old owner's version>
 *                transfer every item the old owner owns to the new owner
 *   4. remove    (token = new owner, latest)
 *                delete the old owner's permission from every item
 *
 * Usage:
 *   tsx scripts/drive-auth/transfer-drive-ownership.ts <phase> \
 *     --old=<email> --new=<email> [--version=N] [--confirm]
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { google, type drive_v3 } from 'googleapis';

const PROJECT = 'peer-evaluator-rubric';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

type Phase = 'grant' | 'transfer' | 'remove';

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

function secret(name: string, version: string): string {
  return gcloud([
    'secrets',
    'versions',
    'access',
    version,
    `--secret=${name}`,
    `--project=${PROJECT}`,
  ]);
}

async function driveAs(version: string): Promise<{ drive: drive_v3.Drive; email: string }> {
  const auth = new google.auth.OAuth2(
    readEnvValue('GOOGLE_OAUTH_CLIENT_ID'),
    secret('GOOGLE_OAUTH_CLIENT_SECRET', 'latest'),
  );
  auth.setCredentials({ refresh_token: secret('DRIVE_OAUTH_REFRESH_TOKEN', version) });
  const drive = google.drive({ version: 'v3', auth });
  const about = await drive.about.get({ fields: 'user(emailAddress)' });
  return { drive, email: about.data.user?.emailAddress?.toLowerCase() ?? '' };
}

interface Item {
  id: string;
  name: string;
  depth: number;
  owners: string[];
}

/** The parent folder and everything under it, parents before children. */
async function walk(drive: drive_v3.Drive, rootId: string): Promise<Item[]> {
  const root = await drive.files.get({ fileId: rootId, fields: 'id,name,owners(emailAddress)' });
  const rootItem: Item = {
    id: rootId,
    name: root.data.name ?? '',
    depth: 0,
    owners: (root.data.owners ?? []).map((o) => o.emailAddress?.toLowerCase() ?? ''),
  };
  const items: Item[] = [rootItem];
  const queue: Item[] = [rootItem];
  for (let parent = queue.shift(); parent; parent = queue.shift()) {
    let pageToken: string | undefined;
    do {
      const res: { data: drive_v3.Schema$FileList } = await drive.files.list({
        q: `'${parent.id}' in parents and trashed = false`,
        fields: 'nextPageToken, files(id,name,mimeType,owners(emailAddress))',
        pageSize: 1000,
        ...(pageToken ? { pageToken } : {}),
      });
      for (const f of res.data.files ?? []) {
        if (!f.id) continue;
        const item: Item = {
          id: f.id,
          name: f.name ?? '',
          depth: parent.depth + 1,
          owners: (f.owners ?? []).map((o) => o.emailAddress?.toLowerCase() ?? ''),
        };
        items.push(item);
        if (f.mimeType === FOLDER_MIME) queue.push(item);
      }
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);
  }
  return items;
}

async function main(): Promise<void> {
  const phase = process.argv[2] as Phase;
  const oldOwner = arg('old')?.toLowerCase();
  const newOwner = arg('new')?.toLowerCase();
  const confirm = process.argv.includes('--confirm');
  if (!['grant', 'transfer', 'remove'].includes(phase) || !oldOwner || !newOwner) {
    throw new Error(
      'Usage: <grant|transfer|remove> --old=<email> --new=<email> [--version=N] [--confirm]',
    );
  }
  const version = arg('version') ?? 'latest';
  const expected = phase === 'remove' ? newOwner : oldOwner;
  const { drive, email } = await driveAs(version);
  if (email !== expected) {
    throw new Error(
      `DRIVE_OAUTH_REFRESH_TOKEN version "${version}" belongs to ${email || '(unknown)'}; ` +
        `phase "${phase}" needs ${expected}. Pass --version=<n> for the right one ` +
        `(gcloud secrets versions list DRIVE_OAUTH_REFRESH_TOKEN --project=${PROJECT}).`,
    );
  }
  const rootId = readEnvValue('DRIVE_PARENT_FOLDER_ID');
  const tag = confirm ? '' : '[dry-run] ';
  console.log(`${tag}phase=${phase} acting as ${email}`);

  if (phase === 'grant') {
    console.log(`${tag}grant ${newOwner} writer on the parent folder`);
    if (confirm) {
      await drive.permissions.create({
        fileId: rootId,
        sendNotificationEmail: false,
        requestBody: { type: 'user', role: 'writer', emailAddress: newOwner },
      });
    }
    return;
  }

  const items = await walk(drive, rootId);
  let done = 0;
  let failed = 0;

  if (phase === 'transfer') {
    const owned = items.filter((i) => i.owners.includes(oldOwner));
    console.log(`${String(items.length)} items; ${String(owned.length)} owned by ${oldOwner}`);
    for (const item of owned) {
      try {
        if (confirm) {
          await drive.permissions.create({
            fileId: item.id,
            // Drive requires the notification email on ownership transfers.
            transferOwnership: true,
            requestBody: { type: 'user', role: 'owner', emailAddress: newOwner },
          });
        }
        done++;
      } catch (err) {
        failed++;
        console.error(`failed ${item.name} (${item.id}):`, (err as Error).message);
      }
    }
    console.log(`${tag}transferred ${String(done)}, failed ${String(failed)}`);
  }

  if (phase === 'remove') {
    const stillOwned = items.filter((i) => i.owners.includes(oldOwner));
    if (stillOwned.length) {
      throw new Error(
        `${String(stillOwned.length)} items are still owned by ${oldOwner}; run transfer first.`,
      );
    }
    // Children first, so the parent-folder grant goes last.
    for (const item of [...items].sort((a, b) => b.depth - a.depth)) {
      const perms = await drive.permissions.list({
        fileId: item.id,
        fields: 'permissions(id,emailAddress)',
      });
      const mine = perms.data.permissions?.find((p) => p.emailAddress?.toLowerCase() === oldOwner);
      if (!mine?.id) continue;
      try {
        if (confirm) await drive.permissions.delete({ fileId: item.id, permissionId: mine.id });
        done++;
      } catch (err) {
        failed++;
        console.error(`failed ${item.name} (${item.id}):`, (err as Error).message);
      }
    }
    console.log(`${tag}removed ${oldOwner} from ${String(done)} items, failed ${String(failed)}`);
  }

  if (failed > 0) process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error('[drive-transfer]', err instanceof Error ? err.message : err);
  process.exit(1);
});
