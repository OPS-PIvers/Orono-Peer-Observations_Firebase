#!/usr/bin/env node
/**
 * Runs the Firebase CLI with an environment the Firestore emulator can
 * actually start in. Forwards every argument through untouched:
 *
 *   node scripts/run-firebase-emulators.mjs emulators:start --import=...
 *
 * Two things need fixing up, both Windows-flavoured but both harmless
 * elsewhere:
 *
 * 1. `firebase-tools` spawns a bare `java`, so it ignores JAVA_HOME and takes
 *    whatever is first on PATH. This box has JDK 17 ahead of JDK 21 on the
 *    machine PATH, and firebase-tools refuses anything before 21. Rather than
 *    require an admin PATH edit, put JAVA_HOME's `bin` first for the child.
 *
 * 2. On Windows the JVM's selector implementation opens an internal AF_UNIX
 *    pipe in `%TEMP%`. Where a machine blocks AF_UNIX connect() inside the
 *    user profile — endpoint security tends to — every `Selector.open()`
 *    fails and the emulator dies with "failed to open a new selector". Point
 *    `%TEMP%` at a directory outside the profile for the child processes.
 *    See docs/local-dev-windows.md.
 *
 *    `-Djdk.net.unixdomain.tmpdir` via JAVA_TOOL_OPTIONS would do the same
 *    thing, but the JVM announces "Picked up JAVA_TOOL_OPTIONS: ..." on
 *    stderr at every launch, and firebase-tools parses the rules runtime's
 *    stderr — the banner surfaces as "Unexpected rules runtime error".
 *    Setting the environment variable is silent.
 *
 * Spawns the CLI's JS entry point directly rather than the `.bin` shim, so
 * argument quoting survives identically on both platforms — the quoted script
 * that `emulators:exec` takes arrives as a single argv entry either way.
 */
import { spawn, spawnSync } from 'node:child_process';
import { accessSync, constants, mkdirSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const isWindows = process.platform === 'win32';

/** Reads the major version from `java -version`, or null if it won't run. */
function javaMajor(javaBin) {
  const probe = spawnSync(javaBin, ['-version'], { encoding: 'utf8' });
  if (probe.error || probe.status !== 0) return null;
  // "openjdk version \"21.0.10\" ..." — also handles the legacy "1.8.0" form.
  const match = /version "(\d+)(?:\.(\d+))?/.exec(`${probe.stderr}${probe.stdout}`);
  if (!match) return null;
  const first = Number(match[1]);
  return first === 1 ? Number(match[2] ?? 0) : first;
}

/** JDK install roots worth scanning when JAVA_HOME is unset or too old. */
function candidateJavaHomes() {
  if (!isWindows) return [];
  const roots = [
    'C:\\Program Files\\Microsoft',
    'C:\\Program Files\\Eclipse Adoptium',
    'C:\\Program Files\\Java',
    'C:\\Program Files\\Amazon Corretto',
  ];
  const found = [];
  for (const root of roots) {
    let entries;
    try {
      entries = readdirSync(root);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (/jdk/i.test(entry)) found.push(path.join(root, entry));
    }
  }
  // Newest name last, so the highest version wins.
  return found.sort();
}

/**
 * Set an environment variable on a plain copy of `process.env`. Windows env
 * vars are case-insensitive but a spread copy is not, so drop every existing
 * spelling first — otherwise `Temp` and `TEMP` both reach the child and the
 * one that wins is anyone's guess.
 */
function setEnvVar(env, name, value) {
  const next = { ...env };
  let previous = '';
  for (const key of Object.keys(next)) {
    if (key.toLowerCase() === name.toLowerCase()) {
      previous ||= next[key] ?? '';
      delete next[key];
    }
  }
  next[name] = value;
  return { next, previous };
}

/** Prepend a JDK 21+ `bin` to PATH, since firebase-tools only reads PATH. */
function withJavaOnPath(env) {
  const exe = isWindows ? 'java.exe' : 'java';
  const homes = [env.JAVA_HOME, ...candidateJavaHomes()].filter(Boolean);

  let best = null;
  for (const home of homes) {
    const bin = path.join(home, 'bin', exe);
    const major = javaMajor(bin);
    if (major !== null && major >= 21 && (best === null || major > best.major)) {
      best = { major, dir: path.dirname(bin) };
    }
  }

  // Nothing better than what is already on PATH — let firebase-tools do its
  // own version check and print its own (clear) error.
  if (!best) return env;

  const withHome = { ...env, JAVA_HOME: path.dirname(best.dir) };
  const { next, previous } = setEnvVar(withHome, 'PATH', '');
  next.PATH = `${best.dir}${path.delimiter}${previous}`;
  return next;
}

/** A writable directory outside the user profile, for the JVM's AF_UNIX pipe. */
function nonProfileTmpDir() {
  const candidates = [
    process.env['OPS_EMULATOR_TMPDIR'],
    'C:\\Windows\\Temp',
    'C:\\ProgramData\\ops-emulator-tmp',
  ].filter(Boolean);

  for (const dir of candidates) {
    try {
      mkdirSync(dir, { recursive: true });
      if (!statSync(dir).isDirectory()) continue;
      accessSync(dir, constants.W_OK);
      return dir;
    } catch {
      // Not usable — try the next one.
    }
  }
  return null;
}

function withNonProfileTmpDir(env) {
  if (!isWindows) return env;
  // An explicit -Djdk.net.unixdomain.tmpdir already answers this.
  if ((env.JAVA_TOOL_OPTIONS ?? '').includes('jdk.net.unixdomain.tmpdir')) return env;

  const dir = nonProfileTmpDir();
  if (!dir) return env;

  return setEnvVar(setEnvVar(env, 'TEMP', dir).next, 'TMP', dir).next;
}

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('usage: node scripts/run-firebase-emulators.mjs <firebase args...>');
  process.exit(2);
}

const firebaseBin = require.resolve('firebase-tools/lib/bin/firebase.js');
const env = withNonProfileTmpDir(withJavaOnPath({ ...process.env }));

const child = spawn(process.execPath, [firebaseBin, ...args], { stdio: 'inherit', env });
child.on('error', (err) => {
  console.error(`[run-firebase-emulators] failed to start the Firebase CLI: ${err.message}`);
  process.exit(1);
});
child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
