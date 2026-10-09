/**
 * Backfill: give each observation's observer and co-observers Reader on its
 * Drive folder.
 *
 * Context. finalizeObservation once shared the folder with the observed staff
 * member only, so the observer hit Drive's request-access page on their own
 * PDF; later the observer was granted but co-observers never were. New
 * uploads, finalizes and co-observer edits now grant every observer; this
 * catches up observations from before that. Covers Drafts too, since a
 * Draft's folder exists once audio or evidence is uploaded.
 *
 * Skips observations with no Drive folder and people who already have any
 * access (a manual share, or an earlier grant from the app).
 *
 * Auth:
 *   - Firestore: application-default credentials
 *     (`gcloud auth application-default login`)
 *   - Drive: the gcloud CLI user token (`gcloud auth print-access-token`),
 *     which must be a user that can share the folders (a Shared Drive Manager) and
 *     was logged in with `gcloud auth login --enable-gdrive-access`.
 *
 * Usage:
 *   pnpm backfill:observer-access:dry-run
 *   pnpm backfill:observer-access:prod -- --confirm
 *
 * Safe to re-run: existing grants are skipped.
 */

import { execSync } from 'node:child_process';
import { config as loadDotenv } from 'dotenv';
import { google } from 'googleapis';
import { COLLECTIONS } from '@ops/shared';
import { initFirestore } from '../import/firebase.js';

loadDotenv();

function driveClient() {
  const token = execSync('gcloud auth print-access-token', { encoding: 'utf-8' }).trim();
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: token });
  return google.drive({ version: 'v3', auth });
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  if (!dryRun && !argv.includes('--confirm')) {
    throw new Error('Refusing to write to prod without --confirm (or pass --dry-run).');
  }

  const db = initFirestore('prod');
  const drive = driveClient();

  const snap = await db.collection(COLLECTIONS.observations).get();

  let granted = 0;
  let already = 0;
  let skipped = 0;
  let failed = 0;

  for (const doc of snap.docs) {
    const folderId = doc.get('driveFolderId') as string | undefined;
    const coObservers = doc.get('coObserverEmails') as unknown;
    const coList: unknown[] = Array.isArray(coObservers) ? coObservers : [];
    const emails = new Set(
      [doc.get('observerEmail') as unknown, ...coList]
        .filter((e): e is string => typeof e === 'string' && e !== '')
        .map((e) => e.toLowerCase()),
    );
    if (!folderId || emails.size === 0) {
      skipped++;
      continue;
    }
    let existing: Set<string>;
    try {
      const perms = await drive.permissions.list({
        fileId: folderId,
        fields: 'permissions(emailAddress,role)',
        supportsAllDrives: true,
      });
      existing = new Set(
        (perms.data.permissions ?? [])
          .map((p) => p.emailAddress?.toLowerCase())
          .filter((e): e is string => !!e),
      );
    } catch (err) {
      failed++;
      console.error(`failed ${doc.id} (list permissions):`, (err as Error).message);
      continue;
    }
    for (const email of emails) {
      if (existing.has(email)) {
        already++;
        continue;
      }
      try {
        console.log(`${dryRun ? '[dry-run] would grant' : 'grant'} ${email} → ${doc.id}`);
        if (!dryRun) {
          await drive.permissions.create({
            fileId: folderId,
            sendNotificationEmail: false,
            supportsAllDrives: true,
            requestBody: { type: 'user', role: 'reader', emailAddress: email },
          });
        }
        granted++;
      } catch (err) {
        failed++;
        console.error(`failed ${doc.id} (${email}):`, (err as Error).message);
      }
    }
  }

  console.log(
    `\nobservations: ${String(snap.size)} | ${dryRun ? 'to grant' : 'granted'}: ${String(granted)} | already had access: ${String(already)} | no folder: ${String(skipped)} | failed: ${String(failed)}`,
  );
  if (failed > 0) process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
