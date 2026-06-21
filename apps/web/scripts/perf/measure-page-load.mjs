// Repeatable page-load performance harness.
//
// Methodology (held constant across every page and every run so results are
// comparable run-to-run):
//   1. Build the production bundle once with a fixed, hermetic Firebase config
//      (no emulator, fake keys) so the SDK initializes without throwing and no
//      network backend is required.
//   2. Serve the built `dist/` with `vite preview` on a fixed localhost port.
//   3. Drive headless Chromium (Playwright) with a fixed viewport, no CPU or
//      network throttling, and a single shared browser context so the HTTP
//      cache is warm — i.e. we measure the returning-visitor load, dominated by
//      JS parse/exec + render rather than cold transfer.
//   4. For each route: one warmup navigation to populate the cache, then N
//      measured navigations. The reported figure is the MEDIAN First
//      Contentful Paint (FCP) — the moment the app shell first paints — which
//      is the user-perceived "page loaded" instant.
//
// A route passes when its median FCP is below THRESHOLD_MS. Exit code is
// non-zero if any route fails, so the harness doubles as a CI-style gate.
//
// Usage:
//   node scripts/perf/measure-page-load.mjs            # build + serve + measure
//   node scripts/perf/measure-page-load.mjs --no-build # reuse existing dist/
//   node scripts/perf/measure-page-load.mjs --runs 11  # override sample count

import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { ROUTES } from './routes.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(__dirname, '../..');

const args = process.argv.slice(2);
const NO_BUILD = args.includes('--no-build');
const RUNS = Number(readFlag('--runs') ?? 9);
const WARMUP = 1;
const PORT = Number(readFlag('--port') ?? 4178);
const THRESHOLD_MS = Number(readFlag('--threshold') ?? 50);
const BASE_URL = `http://127.0.0.1:${String(PORT)}`;

// Hermetic build/runtime config: fake but well-formed so Firebase init never
// throws, and NOT in emulator mode so no local backend is needed. Auth resolves
// to signed-out without any network round-trip.
const BUILD_ENV = {
  ...process.env,
  VITE_FIREBASE_API_KEY: 'fake-perf-harness-api-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'peer-evaluator-rubric.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'peer-evaluator-rubric',
  VITE_FIREBASE_STORAGE_BUCKET: 'peer-evaluator-rubric.firebasestorage.app',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '000000000000',
  VITE_FIREBASE_APP_ID: '1:000000000000:web:0000000000000000',
};

function readFlag(name) {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}

function run(cmd, cmdArgs, opts = {}) {
  return new Promise((res, rej) => {
    const child = spawn(cmd, cmdArgs, { cwd: WEB_ROOT, env: BUILD_ENV, ...opts });
    child.on('error', rej);
    child.on('exit', (code) =>
      code === 0 ? res() : rej(new Error(`${cmd} ${cmdArgs.join(' ')} exited ${String(code)}`)),
    );
  });
}

function median(nums) {
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

async function waitForServer(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {
      // not up yet
    }
    await sleep(200);
  }
  throw new Error(`Server at ${url} did not become ready in ${String(timeoutMs)}ms`);
}

/** Measure one navigation, returning the in-page performance metrics (ms). */
async function measureOnce(page, url) {
  await page.goto(url, { waitUntil: 'load' });
  // First Contentful Paint is recorded asynchronously; give the browser a
  // microtask beat to flush the paint entry, then read the timing buffer.
  return page.evaluate(async () => {
    const nav = performance.getEntriesByType('navigation')[0];
    const readFcp = () =>
      performance.getEntriesByType('paint').find((p) => p.name === 'first-contentful-paint');
    if (!readFcp()) {
      await new Promise((r) => {
        const obs = new PerformanceObserver(() => {
          if (readFcp()) {
            obs.disconnect();
            r();
          }
        });
        obs.observe({ type: 'paint', buffered: true });
        setTimeout(r, 1000);
      });
    }
    const fcp = readFcp();
    return {
      fcp: fcp ? fcp.startTime : Number.NaN,
      domContentLoaded: nav ? nav.domContentLoadedEventEnd : Number.NaN,
      load: nav ? nav.loadEventEnd : Number.NaN,
    };
  });
}

async function main() {
  if (!NO_BUILD) {
    console.log('▶ Building production bundle (hermetic Firebase config)…');
    await run('pnpm', ['exec', 'vite', 'build'], { stdio: 'inherit' });
  }

  console.log(`▶ Starting vite preview on ${BASE_URL}…`);
  const preview = spawn(
    'pnpm',
    ['exec', 'vite', 'preview', '--port', String(PORT), '--strictPort'],
    { cwd: WEB_ROOT, env: BUILD_ENV, stdio: 'ignore' },
  );
  preview.on('error', (e) => {
    console.error('preview failed:', e);
    process.exit(1);
  });

  let browser;
  try {
    await waitForServer(BASE_URL);
    browser = await chromium.launch({
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();

    const results = [];
    for (const route of ROUTES) {
      const url = BASE_URL + route.path;
      for (let i = 0; i < WARMUP; i++) await measureOnce(page, url);
      const samples = [];
      for (let i = 0; i < RUNS; i++) {
        const m = await measureOnce(page, url);
        if (Number.isFinite(m.fcp)) samples.push(m.fcp);
      }
      const medFcp = median(samples);
      results.push({ name: route.name, path: route.path, fcp: medFcp, samples });
    }

    // Report
    const pad = (s, n) => String(s).padEnd(n);
    const padN = (s, n) => String(s).padStart(n);
    console.log(
      `\nPage-load performance — median FCP over ${String(RUNS)} runs (warm cache, localhost)\n`,
    );
    console.log(`${pad('Route', 28)}${pad('Path', 42)}${padN('FCP(ms)', 9)}  Status`);
    console.log('─'.repeat(92));
    let failed = 0;
    for (const r of results.sort((a, b) => b.fcp - a.fcp)) {
      const ok = r.fcp < THRESHOLD_MS;
      if (!ok) failed++;
      console.log(
        `${pad(r.name, 28)}${pad(r.path, 42)}${padN(r.fcp.toFixed(1), 9)}  ${ok ? '✓' : '✗ OVER'}`,
      );
    }
    const worst = Math.max(...results.map((r) => r.fcp));
    const best = Math.min(...results.map((r) => r.fcp));
    console.log('─'.repeat(92));
    console.log(
      `Routes: ${String(results.length)}  •  worst: ${worst.toFixed(1)}ms  •  best: ${best.toFixed(1)}ms  •  threshold: ${String(THRESHOLD_MS)}ms  •  over: ${String(failed)}`,
    );

    await browser.close();
    preview.kill();
    process.exit(failed === 0 ? 0 : 1);
  } catch (err) {
    console.error(err);
    if (browser) await browser.close();
    preview.kill();
    process.exit(1);
  }
}

await main();
