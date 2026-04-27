import { defineConfig } from 'tsup';

/**
 * Bundle the Cloud Run service with @ops/shared inlined; everything else
 * (Hono, Puppeteer, firebase-admin) stays external and is resolved from
 * package.json at deploy/runtime.
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
