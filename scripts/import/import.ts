/**
 * Sheet → Firestore import — Phase 2 placeholder.
 *
 * Ports the GAS app's data into Firestore at cutover. Reads:
 *   - Staff sheet → /staff/{email}
 *   - Settings sheet → /settings/roleYearMappings/{role}_{year}
 *   - Per-role rubric sheets → /rubrics/{roleId} + /roles/{roleId}
 *   - WorkProductQuestions sheet → /workProductQuestions/{id}
 *   - Observation_Data sheet (finalized only) → /observations/{id}
 *
 * Two targets, distinguished by --target flag:
 *   - emulator  : writes to local Firestore emulator (development seed)
 *   - prod      : one-shot writes to live Firestore (cutover; requires --confirm)
 */

const target = process.argv.find((a) => a.startsWith('--target='))?.split('=')[1];

if (target !== 'emulator' && target !== 'prod') {
  console.error('Usage: tsx scripts/import/import.ts --target=emulator|prod [--confirm]');
  process.exit(1);
}

if (target === 'prod' && !process.argv.includes('--confirm')) {
  console.error(
    'Refusing to run against prod without --confirm. This is a destructive one-shot operation.',
  );
  process.exit(1);
}

console.log(`[import] target=${target} — Phase 2 implementation pending.`);
