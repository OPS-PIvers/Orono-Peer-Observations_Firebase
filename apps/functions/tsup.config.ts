import { defineConfig } from 'tsup';

/**
 * tsup bundles Cloud Functions sources + the @ops/shared workspace package
 * into a single self-contained output that Firebase can deploy without
 * needing pnpm/workspace resolution server-side.
 *
 * - `noExternal: ['@ops/shared']` inlines the workspace package
 * - All other deps stay external (firebase-admin, firebase-functions, zod, ...)
 *   and are installed by Firebase's deploy pipeline from package.json
 */
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  outDir: 'lib',
  target: 'node22',
  splitting: false,
  sourcemap: true,
  clean: true,
  dts: false,
  noExternal: ['@ops/shared'],
});
