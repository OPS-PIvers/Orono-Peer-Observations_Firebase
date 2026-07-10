// Dev-only auth helper: mints Firebase custom tokens for existing Auth
// users so the local Vite dev server (or Playwright/Chrome MCP) can sign
// in without going through Google OAuth. Uses Application Default
// Credentials — whatever `gcloud auth application-default login` set up.
//
// IMPORTANT: this script is local-only and never deployed. It binds to
// 127.0.0.1 so it's not reachable from the LAN. The browser-side
// counterpart (apps/web/src/auth/DevSignIn.tsx) only renders in dev
// builds (Vite tree-shakes it out of `pnpm build`).
//
// Run with:
//   pnpm dev:auth-server
//
// Env:
//   DEV_AUTH_PORT   — listen port (default 8787)
//   FIREBASE_PROJECT_ID — Firebase project ID (see scripts/lib/project-id.mjs)

import http from 'node:http';
import { initializeApp, applicationDefault, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { PROJECT_ID } from './lib/project-id.mjs';
const PORT = Number(process.env.DEV_AUTH_PORT ?? '8787');
// SA used to sign custom tokens. ADC (your gcloud user creds) can mint
// tokens by calling `iam.serviceAccounts.signBlob` on this SA — owner /
// Service Account Token Creator on the project gives you that permission.
const SERVICE_ACCOUNT_ID =
  process.env.FIREBASE_SERVICE_ACCOUNT ?? `peer-eval-svc@${PROJECT_ID}.iam.gserviceaccount.com`;

if (getApps().length === 0) {
  initializeApp({
    credential: applicationDefault(),
    projectId: PROJECT_ID,
    serviceAccountId: SERVICE_ACCOUNT_ID,
  });
}

const auth = getAuth();

function setCors(res) {
  // Vite dev server runs on 5173 by default. Allow any localhost origin
  // so the dev-server doesn't break if the port shifts.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

const server = http.createServer(async (req, res) => {
  setCors(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', projectId: PROJECT_ID }));
    return;
  }

  if (req.method === 'POST' && req.url === '/mint') {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    let email;
    try {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      email = body.email;
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      return;
    }
    if (typeof email !== 'string' || email.length === 0) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'email required' }));
      return;
    }
    try {
      // Look up the user, or create them if missing. Live Firebase Auth
      // tenants on the Spark plan will only have user records for people
      // who've actually signed in — useful for smoke-testing without
      // having to do the OAuth dance first. Idempotent.
      let user;
      try {
        user = await auth.getUserByEmail(email);
      } catch (err) {
        if (err?.code === 'auth/user-not-found') {
          user = await auth.createUser({ email, emailVerified: true });
          console.log(`[dev-auth-server] created user ${email} (uid=${user.uid})`);
        } else {
          throw err;
        }
      }
      const customToken = await auth.createCustomToken(user.uid);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ customToken, uid: user.uid, email: user.email }));
    } catch (err) {
      console.error('mint failed', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err?.message ?? 'mint failed' }));
    }
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[dev-auth-server] listening on http://127.0.0.1:${PORT}`);
  console.log(`[dev-auth-server] project: ${PROJECT_ID}`);
  console.log(`[dev-auth-server] POST /mint  body={"email":"..."}  → custom token`);
});
