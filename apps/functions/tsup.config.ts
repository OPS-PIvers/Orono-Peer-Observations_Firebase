import { copyFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

/**
 * tsup bundles Cloud Functions sources + the @ops/shared workspace package
 * into a single self-contained output that Firebase can deploy without
 * needing pnpm/workspace resolution server-side.
 *
 * - `noExternal: ['@ops/shared']` inlines the workspace package
 * - All other deps stay external (firebase-admin, firebase-functions, zod, ...)
 *   and are installed by Firebase's deploy pipeline from package.json
 *
 * Firebase deploys from `apps/functions/lib` (see firebase.json), so we
 * also write a deploy-ready package.json into lib/ that contains only
 * runtime npm-resolvable dependencies — workspace:* refs would crash
 * Cloud Build's npm install with EUNSUPPORTEDPROTOCOL.
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
  onSuccess: async () => {
    interface SrcPkg {
      name: string;
      version: string;
      engines?: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    }
    const src = JSON.parse(readFileSync('package.json', 'utf-8')) as SrcPkg;
    const runtimeDeps = { ...(src.dependencies ?? {}) };
    // Strip workspace: protocol entries — these come from monorepo links
    // that Cloud Build's npm can't resolve. The corresponding code is
    // bundled into lib/index.js via `noExternal` above.
    for (const [name, version] of Object.entries(runtimeDeps)) {
      if (version.startsWith('workspace:')) delete runtimeDeps[name];
    }
    const deployPkg = {
      name: src.name,
      version: src.version,
      private: true,
      type: 'module',
      main: 'index.js',
      engines: src.engines,
      dependencies: runtimeDeps,
    };
    writeFileSync('lib/package.json', `${JSON.stringify(deployPkg, null, 2)}\n`);

    // Mirror Firebase v2 params files (.env, .env.<projectId>) into lib/
    // so they're picked up by the deploy. We deploy from lib/, not from
    // apps/functions, so the source-dir env files don't reach the upload
    // unless we copy them here.
    if (existsSync('.')) {
      for (const name of readdirSync('.')) {
        if (name.startsWith('.env') && !name.endsWith('.local')) {
          copyFileSync(name, `lib/${name}`);
        }
      }
    }
  },
});
