// Dev-only auth helper: mints Firebase custom tokens so the local Vite dev
// server (or Playwright/Chrome MCP) can sign in without going through Google
// OAuth. Local-only, never deployed. The browser-side counterpart
// (apps/web/src/auth/DevSignIn.tsx) only renders in dev builds.
//
// Run with:
//   pnpm dev:auth-server        — Auth emulator only (FIREBASE_AUTH_EMULATOR_HOST
//                                 must be set, as it is under emulators:exec)
//   pnpm dev:auth-server:live   — the live project, using Application Default
//                                 Credentials (`gcloud auth application-default login`)
//
// Security model. The browser never talks to this server directly: Vite's
// dev server proxies same-origin POSTs from /__dev-auth/mint to it
// (apps/web/vite-dev-auth-proxy.ts) and adds the per-run secret below. So:
//   - every request must carry the secret in the X-Dev-Auth-Secret header.
//     It's random per run (or DEV_AUTH_SECRET) and written to a 0600 file in
//     the OS temp dir for the Vite proxy to read; no page can obtain it.
//   - Host must be a loopback name (blocks DNS rebinding), and any request
//     carrying an Origin header that isn't a local Vite origin is refused.
//     No CORS headers are sent, so no foreign origin can read a response.
//   - against the live project (--live) the server never creates Auth users
//     and only mints tokens for an explicit allowlist: the ADC user's own
//     email plus DEV_AUTH_ALLOWED_EMAILS.
//
// Env:
//   DEV_AUTH_PORT            — listen port (default 8787)
//   DEV_AUTH_SECRET          — fixed secret instead of a random per-run one
//   DEV_AUTH_ALLOWED_EMAILS  — live mode only: extra comma-separated emails
//                              that may be signed in as (existing users only)
//   FIREBASE_PROJECT_ID      — Firebase project ID (see scripts/lib/project-id.mjs)

import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import { initializeApp, applicationDefault, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { PROJECT_ID } from './lib/project-id.mjs';
import {
  DEV_AUTH_SECRET_HEADER,
  devAuthSecretPath,
  isAllowedDevOrigin,
  isLoopbackHost,
} from './lib/dev-auth.mjs';

const PORT = Number(process.env.DEV_AUTH_PORT ?? '8787');
const MAX_BODY_BYTES = 4096;

// When the Auth emulator is targeted (FIREBASE_AUTH_EMULATOR_HOST set — the
// case in CI and `pnpm dev:emulators`), the Admin SDK mints custom tokens
// with the emulator's built-in signer, so no real credentials are needed.
const usingAuthEmulator = Boolean(process.env.FIREBASE_AUTH_EMULATOR_HOST);
const liveOptIn = process.argv.includes('--live');

if (!usingAuthEmulator && !liveOptIn) {
  console.error(
    `[dev-auth-server] FIREBASE_AUTH_EMULATOR_HOST is not set, so this would mint tokens for the live project "${PROJECT_ID}".\n` +
      '[dev-auth-server] Refusing. Run it under the emulator suite, or opt in with `pnpm dev:auth-server:live`.',
  );
  process.exit(1);
}
if (usingAuthEmulator && liveOptIn) {
  console.error('[dev-auth-server] --live and FIREBASE_AUTH_EMULATOR_HOST are mutually exclusive.');
  process.exit(1);
}

if (getApps().length === 0) {
  if (usingAuthEmulator) {
    initializeApp({ projectId: PROJECT_ID });
  } else {
    // SA used to sign custom tokens. ADC (your gcloud user creds) can mint
    // tokens by calling `iam.serviceAccounts.signBlob` on this SA — owner /
    // Service Account Token Creator on the project gives you that permission.
    initializeApp({
      credential: applicationDefault(),
      projectId: PROJECT_ID,
      serviceAccountId:
        process.env.FIREBASE_SERVICE_ACCOUNT ??
        `peer-eval-svc@${PROJECT_ID}.iam.gserviceaccount.com`,
    });
  }
}

const auth = getAuth();

/** Email of the gcloud user behind Application Default Credentials. */
async function adcUserEmail() {
  try {
    const { access_token } = await applicationDefault().getAccessToken();
    const res = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(access_token)}`,
    );
    if (!res.ok) return null;
    const info = await res.json();
    return typeof info.email === 'string' ? info.email.toLowerCase() : null;
  } catch {
    return null;
  }
}

// Live mode: the set of emails that may be minted. null = any (emulator).
let allowedEmails = null;
if (!usingAuthEmulator) {
  allowedEmails = new Set(
    (process.env.DEV_AUTH_ALLOWED_EMAILS ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
  const own = await adcUserEmail();
  if (own) allowedEmails.add(own);
  if (allowedEmails.size === 0) {
    console.error(
      '[dev-auth-server] Could not read your email from Application Default Credentials and DEV_AUTH_ALLOWED_EMAILS is empty.\n' +
        '[dev-auth-server] Run `gcloud auth application-default login` or set DEV_AUTH_ALLOWED_EMAILS.',
    );
    process.exit(1);
  }
}

const SECRET = process.env.DEV_AUTH_SECRET || crypto.randomBytes(32).toString('hex');
const SECRET_BUF = Buffer.from(SECRET);
const SECRET_FILE = devAuthSecretPath(PORT);
function removeSecretFile() {
  try {
    if (fs.readFileSync(SECRET_FILE, 'utf8') === SECRET) fs.unlinkSync(SECRET_FILE);
  } catch {
    // already gone
  }
}
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => process.exit(0));
}

function hasValidSecret(req) {
  const given = req.headers[DEV_AUTH_SECRET_HEADER];
  if (typeof given !== 'string') return false;
  const buf = Buffer.from(given);
  return buf.length === SECRET_BUF.length && crypto.timingSafeEqual(buf, SECRET_BUF);
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

const server = http.createServer(async (req, res) => {
  // DNS rebinding guard: a rebound hostname still sends its own Host header.
  if (!isLoopbackHost(req.headers.host)) {
    send(res, 403, { error: 'Host not allowed' });
    return;
  }
  // The Vite proxy is a Node client and sends no Origin; a browser always
  // does on cross-origin requests. Anything not from a local dev page is out.
  const origin = req.headers.origin;
  if (origin !== undefined && !isAllowedDevOrigin(origin)) {
    send(res, 403, { error: 'Origin not allowed' });
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    send(res, 200, { status: 'ok', projectId: PROJECT_ID, emulator: usingAuthEmulator });
    return;
  }

  if (req.method === 'POST' && req.url === '/mint') {
    if (!hasValidSecret(req)) {
      send(res, 401, { error: 'Missing or wrong dev-auth secret' });
      return;
    }
    if (!(req.headers['content-type'] ?? '').startsWith('application/json')) {
      send(res, 415, { error: 'Content-Type must be application/json' });
      return;
    }
    const raw = await readBody(req);
    if (raw === null) {
      send(res, 413, { error: 'Body too large' });
      return;
    }
    let email;
    try {
      email = JSON.parse(raw).email;
    } catch {
      send(res, 400, { error: 'Invalid JSON body' });
      return;
    }
    if (typeof email !== 'string' || email.length === 0) {
      send(res, 400, { error: 'email required' });
      return;
    }
    if (allowedEmails && !allowedEmails.has(email.trim().toLowerCase())) {
      console.warn(`[dev-auth-server] refused ${email}: not on the live allowlist`);
      send(res, 403, {
        error: `${email} is not allowed. Add it to DEV_AUTH_ALLOWED_EMAILS to sign in as it.`,
      });
      return;
    }
    try {
      let user;
      try {
        user = await auth.getUserByEmail(email);
      } catch (err) {
        // Only the emulator gets missing users created (the e2e specs rely
        // on it). A live tenant is never written to.
        if (err?.code === 'auth/user-not-found' && usingAuthEmulator) {
          user = await auth.createUser({ email, emailVerified: true });
          console.log(`[dev-auth-server] created emulator user ${email} (uid=${user.uid})`);
        } else if (err?.code === 'auth/user-not-found') {
          send(res, 404, { error: `No Auth user for ${email}. Sign in with Google once first.` });
          return;
        } else {
          throw err;
        }
      }
      const customToken = await auth.createCustomToken(user.uid);
      send(res, 200, { customToken, uid: user.uid, email: user.email });
    } catch (err) {
      console.error('mint failed', err);
      send(res, 500, { error: err?.message ?? 'mint failed' });
    }
    return;
  }

  send(res, 404, { error: 'Not found' });
});

server.on('error', (err) => {
  console.error(`[dev-auth-server] ${err.message}`);
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  // Only once the port is ours, so a second copy can't clobber the secret
  // of one that's already running.
  fs.writeFileSync(SECRET_FILE, SECRET, { mode: 0o600 });
  process.on('exit', removeSecretFile);
  console.log(`[dev-auth-server] listening on http://127.0.0.1:${PORT}`);
  console.log(
    `[dev-auth-server] project: ${PROJECT_ID} (${usingAuthEmulator ? 'Auth emulator' : 'LIVE'})`,
  );
  if (allowedEmails) {
    console.log(`[dev-auth-server] may sign in as: ${[...allowedEmails].join(', ')}`);
  }
  console.log(
    '[dev-auth-server] sign in at http://localhost:5173/dev-sign-in (via the Vite proxy)',
  );
});
