/**
 * Seed the built-in system email templates into Firestore.
 *
 * Create-only: a template that already exists is left untouched, so any edits
 * made in the Email Templates admin page are preserved. Safe to re-run to
 * backfill newly-added SYSTEM_TEMPLATES entries.
 *
 * Auth (prod): Application Default Credentials
 * (`gcloud auth application-default login`) or GOOGLE_APPLICATION_CREDENTIALS.
 *
 *   pnpm seed:templates              # prod
 *   pnpm seed:templates --emulator   # local emulator
 *   pnpm seed:templates --dry-run    # report only, no writes
 */

import { config as loadDotenv } from 'dotenv';
import { FieldValue } from 'firebase-admin/firestore';
import { COLLECTIONS } from '@ops/shared';
import { initFirestore, type ImportTarget } from './firebase.js';
import { SYSTEM_TEMPLATES } from './seed.js';

loadDotenv();

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  // Refresh existing *system* templates with the packaged bodies. Only touches
  // docs still flagged isSystem, so admin-created/customized templates are safe.
  const overwriteSystem = process.argv.includes('--overwrite-system');
  const target: ImportTarget = process.argv.includes('--emulator') ? 'emulator' : 'prod';
  const db = initFirestore(target);

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const tmpl of SYSTEM_TEMPLATES) {
    const ref = db.collection(COLLECTIONS.emailTemplates).doc(tmpl.templateId);
    const snap = await ref.get();

    if (snap.exists) {
      const existing = snap.data();
      if (!overwriteSystem || existing?.['isSystem'] !== true) {
        console.log(`  skip      ${tmpl.templateId} (already exists)`);
        skipped += 1;
        continue;
      }
      if (!dryRun) {
        // Refresh content only; leave createdAt + the admin-toggled isActive.
        await ref.set(
          {
            name: tmpl.name,
            description: tmpl.description,
            subject: tmpl.subject,
            bodyHtml: tmpl.bodyHtml,
            variables: tmpl.variables,
            triggerType: tmpl.triggerType,
            recipient: tmpl.recipient,
            scheduledDays: tmpl.scheduledDays,
            isSystem: true,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      }
      console.log(`  ${dryRun ? 'would update' : 'update'}  ${tmpl.templateId} — ${tmpl.name}`);
      updated += 1;
      continue;
    }

    if (!dryRun) {
      await ref.set({
        ...tmpl,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    console.log(`  ${dryRun ? 'would create' : 'create'}  ${tmpl.templateId} — ${tmpl.name}`);
    created += 1;
  }

  console.log(
    `\n[seed:templates] target=${target}${dryRun ? ' (dry-run)' : ''} ` +
      `created=${created} updated=${updated} skipped=${skipped} total=${SYSTEM_TEMPLATES.length}`,
  );
}

main().catch((err: unknown) => {
  console.error('[seed:templates] failed:', err);
  process.exit(1);
});
