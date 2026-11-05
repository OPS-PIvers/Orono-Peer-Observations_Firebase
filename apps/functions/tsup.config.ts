import {
  copyFileSync,
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { defineConfig } from 'tsup';
import { parse as parseYaml } from 'yaml';

/**
 * tsup bundles Cloud Functions sources + the @ops/shared workspace package
 * into a single self-contained output that Firebase can deploy without
 * needing pnpm/workspace resolution server-side.
 *
 * - `noExternal: ['@ops/shared']` inlines the workspace package
 * - All other deps stay external (firebase-admin, firebase-functions, zod, ...)
 *   and are installed with `npm ci` from lib/package-lock.json, both by the
 *   deploy workflows and by Cloud Build
 *
 * Firebase deploys from `apps/functions/lib` (see firebase.json), so we
 * also write a deploy-ready package.json into lib/ that contains only
 * runtime npm-resolvable dependencies — workspace:* refs would crash
 * Cloud Build's npm install with EUNSUPPORTEDPROTOCOL — plus a
 * package-lock.json derived from pnpm-lock.yaml, so the deployed tree is
 * exactly the reviewed lock (pnpm.overrides included) rather than whatever
 * the registry serves on deploy day.
 */

interface LockSnapshot {
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  optional?: boolean;
}
interface PnpmLock {
  importers: Record<
    string,
    {
      dependencies?: Record<string, { specifier: string; version: string }>;
    }
  >;
  packages: Record<
    string,
    { resolution: { integrity?: string }; engines?: Record<string, string> }
  >;
  snapshots: Record<string, LockSnapshot | null>;
}
interface NpmLockEntry {
  name?: string;
  version: string;
  resolved: string;
  integrity: string;
  optional?: true;
  hasInstallScript?: true;
  bin?: Record<string, string>;
  engines?: Record<string, string>;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

/**
 * Translate the `apps/functions` production closure of pnpm-lock.yaml into
 * an npm lockfile v3. Every entry carries the exact version and integrity
 * pnpm recorded, and each dependency spec is that exact version, so
 * `npm ci` installs this tree or fails; it never asks the registry which
 * version to use. Packages are placed npm-style: hoisted to the root
 * node_modules unless a different version of the same name is already
 * visible from the dependent, in which case they nest under it. The lock
 * does not record bins or install scripts, so those are read from the
 * manifests pnpm installed (which must match the locked versions).
 */
function buildDeployLockfile(rootPkg: {
  name: string;
  version: string;
  engines?: Record<string, string>;
  dependencies: Record<string, string>;
}) {
  const lock = parseYaml(readFileSync('../../pnpm-lock.yaml', 'utf-8')) as PnpmLock;
  const importer = lock.importers['apps/functions'];
  if (!importer) throw new Error('pnpm-lock.yaml has no apps/functions importer');
  // A stale lock fails `pnpm install --frozen-lockfile`, and a locked
  // version outside lib/package.json's range fails `npm ci`.
  const rootRefs: Record<string, string> = {};
  for (const name of Object.keys(rootPkg.dependencies)) {
    const dep = importer.dependencies?.[name];
    if (!dep) throw new Error(`pnpm-lock.yaml does not lock ${name}; run pnpm install`);
    rootRefs[name] = dep.version;
  }

  // A pnpm ref is `1.2.3`, `1.2.3(peer@x)`, or an alias `real-name@1.2.3`.
  const parseRef = (name: string, ref: string) => {
    if (!/^\d/.test(ref) && !/^@?[^@()]+@\d/.test(ref)) {
      throw new Error(`Unsupported pnpm dependency ${name}: ${ref}`);
    }
    const snapshotKey = /^\d/.test(ref) ? `${name}@${ref}` : ref;
    const pkgKey = snapshotKey.replace(/\(.*$/, '');
    const at = pkgKey.lastIndexOf('@');
    return { snapshotKey, pkgKey, realName: pkgKey.slice(0, at), version: pkgKey.slice(at + 1) };
  };
  const childPath = (parent: string, name: string) =>
    `${parent ? `${parent}/` : ''}node_modules/${name}`;
  const parentPath = (path: string) => {
    const i = path.lastIndexOf('/node_modules/');
    return i === -1 ? '' : path.slice(0, i);
  };

  // Node-style lookup of a dependency's directory in the pnpm install.
  const findPkgDir = (fromDir: string, name: string) => {
    for (let d = fromDir; ; d = dirname(d)) {
      const candidate = join(d, 'node_modules', name);
      if (basename(d) !== 'node_modules' && existsSync(candidate)) return realpathSync(candidate);
      if (dirname(d) === d) throw new Error(`Cannot find installed ${name} from ${fromDir}`);
    }
  };

  const placed = new Map<string, string>(); // lockfile path -> snapshot key
  const pkgDirs = new Map<string, string>([['', realpathSync('.')]]); // lockfile path -> pnpm dir
  const packages: Record<string, NpmLockEntry | Record<string, unknown>> = {
    '': {
      name: rootPkg.name,
      version: rootPkg.version,
      engines: rootPkg.engines,
      dependencies: rootPkg.dependencies,
    },
  };
  const queue: { path: string; deps: [string, string, boolean][] }[] = [
    { path: '', deps: Object.entries(rootRefs).map(([n, r]) => [n, r, false]) },
  ];
  while (queue.length > 0) {
    const { path, deps } = queue.shift()!;
    const entry = packages[path] as NpmLockEntry;
    for (const [name, ref, isOptional] of deps) {
      const target = parseRef(name, ref);
      if (path) {
        const spec =
          target.realName === name ? target.version : `npm:${target.realName}@${target.version}`;
        (entry[isOptional ? 'optionalDependencies' : 'dependencies'] ??= {})[name] = spec;
      }
      // Resolve like Node: nearest node_modules/<name> walking up from `path`.
      let found: string | undefined;
      for (let p = path; ; p = parentPath(p)) {
        if (placed.has(childPath(p, name))) {
          found = childPath(p, name);
          break;
        }
        if (!p) break;
      }
      if (found && placed.get(found) === target.snapshotKey) continue;
      const at = found ? childPath(path, name) : childPath('', name);
      if (at.split('/node_modules/').length > 64) throw new Error(`Runaway nesting at ${at}`);
      const pkg = lock.packages[target.pkgKey];
      const snapshot = lock.snapshots[target.snapshotKey];
      const integrity = pkg?.resolution.integrity;
      if (!integrity || snapshot === undefined) {
        throw new Error(`pnpm-lock.yaml has no registry entry for ${target.snapshotKey}`);
      }
      const base = target.realName.slice(target.realName.lastIndexOf('/') + 1);
      const dir = findPkgDir(pkgDirs.get(path)!, name);
      const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8')) as {
        name: string;
        version: string;
        bin?: string | Record<string, string>;
        scripts?: Record<string, string>;
      };
      if (manifest.name !== target.realName || manifest.version !== target.version) {
        throw new Error(`Installed ${dir} does not match pnpm-lock.yaml; run pnpm install`);
      }
      const bin = typeof manifest.bin === 'string' ? { [base]: manifest.bin } : manifest.bin;
      const scripts = manifest.scripts ?? {};
      placed.set(at, target.snapshotKey);
      pkgDirs.set(at, dir);
      packages[at] = {
        ...(target.realName === name ? {} : { name: target.realName }),
        version: target.version,
        resolved: `https://registry.npmjs.org/${target.realName}/-/${base}-${target.version}.tgz`,
        integrity,
        ...(snapshot?.optional ? { optional: true } : {}),
        ...(scripts.preinstall || scripts.install || scripts.postinstall
          ? { hasInstallScript: true }
          : {}),
        ...(bin ? { bin } : {}),
        ...(pkg.engines ? { engines: pkg.engines } : {}),
      };
      queue.push({
        path: at,
        deps: [
          ...Object.entries(snapshot?.dependencies ?? {}).map(
            ([n, r]): [string, string, boolean] => [n, r, false],
          ),
          ...Object.entries(snapshot?.optionalDependencies ?? {}).map(
            ([n, r]): [string, string, boolean] => [n, r, true],
          ),
        ],
      });
    }
  }
  return {
    name: rootPkg.name,
    version: rootPkg.version,
    lockfileVersion: 3,
    requires: true,
    packages,
  };
}

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
    writeFileSync(
      'lib/package-lock.json',
      `${JSON.stringify(buildDeployLockfile(deployPkg), null, 2)}\n`,
    );

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
