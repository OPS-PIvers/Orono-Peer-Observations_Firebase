/**
 * One-time backfill: give each finalized observation's observer Reader on its
 * Drive folder.
 *
 * Context. Until this fix, finalizeObservation shared the observation folder
 * with the observed staff member only, so the observer who wrote and
 * finalized it hit Drive's request-access page on their own PDF (and the
 * request went to the folder owner). New finalizes now grant the observer
 * too; this catches up the observations finalized before that.
 *
 * Skips observations with no Drive folder and observers who already have any
 * access (a manual share, or a grant from regenerate/evidence/audio).
 *
 * Auth:
 *   - Firestore: application-default credentials
 *     (`gcloud auth application-default login`)
 *   - Drive: the gcloud CLI user token (`gcloud auth print-access-token`),
 *     which must be a user that can share the folders (the folder owner) and
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
import { COLLECTIONS, OBSERVATION_STATUS } from '@ops/shared';
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

  const snap = await db
    .collection(COLLECTIONS.observations)
    .where('status', '==', OBSERVATION_STATUS.finalized)
    .get();

  let granted = 0;
  let already = 0;
  let skipped = 0;
  let failed = 0;

  for (const doc of snap.docs) {
    const folderId = doc.get('driveFolderId') as string | undefined;
    const observerEmail = (doc.get('observerEmail') as string | undefined)?.toLowerCase();
    if (!folderId || !observerEmail) {
      skipped++;
      continue;
    }
    try {
      const perms = await drive.permissions.list({
        fileId: folderId,
        fields: 'permissions(emailAddress,role)',
        supportsAllDrives: true,
      });
      const has = perms.data.permissions?.some(
        (p) => p.emailAddress?.toLowerCase() === observerEmail,
      );
      if (has) {
        already++;
        continue;
      }
      console.log(`${dryRun ? '[dry-run] would grant' : 'grant'} ${observerEmail} → ${doc.id}`);
      if (!dryRun) {
        await drive.permissions.create({
          fileId: folderId,
          sendNotificationEmail: false,
          supportsAllDrives: true,
          requestBody: { type: 'user', role: 'reader', emailAddress: observerEmail },
        });
      }
      granted++;
    } catch (err) {
      failed++;
      console.error(`failed ${doc.id} (${observerEmail}):`, (err as Error).message);
    }
  }

  console.log(
    `\nfinalized: ${String(snap.size)} | ${dryRun ? 'to grant' : 'granted'}: ${String(granted)} | already had access: ${String(already)} | no folder/observer: ${String(skipped)} | failed: ${String(failed)}`,
  );
  if (failed > 0) process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
