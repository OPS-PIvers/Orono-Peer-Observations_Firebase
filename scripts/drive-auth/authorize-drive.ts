/**
 * One-time (or re-run when revoked): authorize Cloud Functions to use Google
 * Drive as a real Workspace user, and store the resulting refresh token in
 * Secret Manager as `DRIVE_OAUTH_REFRESH_TOKEN`.
 *
 * Why. The observations parent folder lives in a user's My Drive. A file in
 * My Drive counts against its owner's storage, and a file the service account
 * uploads is owned by the service account — which has no storage at all, so
 * every upload failed `403 Service Accounts do not have storage quota`. Acting
 * as the folder owner makes uploads land owned by, and counted against, that
 * user. See `getDriveClient` in apps/functions/src/lib/drive.ts.
 *
 * What it does:
 *   1. Reads the OAuth web client id from apps/functions/.env.<project> and the
 *      client secret from Secret Manager (GOOGLE_OAUTH_CLIENT_SECRET) — the
 *      same client the Calendar connect flow uses.
 *   2. Opens Google's consent page (Drive scope, offline access) and catches
 *      the redirect on a localhost listener.
 *   3. Exchanges the code, confirms the signed-in account can add files to the
 *      parent folder, and pipes the refresh token into Secret Manager.
 *      The token is never printed.
 *
 * The redirect URI must be registered on the OAuth client. The default reuses
 * the Calendar callback on the Vite dev port, so stop `pnpm dev` first.
 *
 * Usage:
 *   pnpm drive:authorize
 *   pnpm drive:authorize -- --redirect-uri=http://localhost:8765/callback
 *
 * Then redeploy functions so they pick up the new secret version.
 */

import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve } from 'node:path';

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';
const SECRET_NAME = 'DRIVE_OAUTH_REFRESH_TOKEN';
const CLIENT_SECRET_NAME = 'GOOGLE_OAUTH_CLIENT_SECRET';

interface CliArgs {
  project: string;
  redirectUri: string;
  loginHint: string | null;
}

function parseArgs(argv: string[]): CliArgs {
  const get = (name: string) =>
    argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
  return {
    project: get('project') ?? 'peer-evaluator-rubric',
    redirectUri: get('redirect-uri') ?? 'http://localhost:5173/oauth/google-calendar/callback',
    loginHint: get('login-hint'),
  };
}

/** Run gcloud, returning stdout. `input` is piped to stdin. Never echoes output. */
function gcloud(args: string[], input?: string): { ok: boolean; stdout: string; stderr: string } {
  const result = spawnSync('gcloud', args, {
    encoding: 'utf8',
    input,
    shell: process.platform === 'win32',
  });
  return { ok: result.status === 0, stdout: result.stdout, stderr: result.stderr };
}

function readEnvValue(project: string, key: string): string {
  const path = resolve('apps/functions', `.env.${project}`);
  const line = readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .find((l) => l.startsWith(`${key}=`));
  const value = line?.slice(key.length + 1).trim();
  if (!value) throw new Error(`${key} is not set in ${path}`);
  return value;
}

function openBrowser(url: string): void {
  if (process.platform === 'win32') {
    spawnSync('cmd', ['/c', 'start', '""', `"${url}"`], { shell: true });
  } else {
    spawnSync(process.platform === 'darwin' ? 'open' : 'xdg-open', [url]);
  }
}

function base64Url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Wait for Google to redirect back with ?code=…&state=… */
function waitForCode(redirectUri: string, expectedState: string): Promise<string> {
  const url = new URL(redirectUri);
  return new Promise((resolvePromise, reject) => {
    const server = createServer((req, res) => {
      const reqUrl = new URL(req.url ?? '/', url.origin);
      if (reqUrl.pathname !== url.pathname) {
        res.writeHead(404).end();
        return;
      }
      const error = reqUrl.searchParams.get('error');
      const code = reqUrl.searchParams.get('code');
      const state = reqUrl.searchParams.get('state');
      const finish = (message: string) => {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }).end(message);
        server.close();
      };
      if (error) {
        finish(`Authorization failed: ${error}. You can close this tab.`);
        reject(new Error(`Google returned error: ${error}`));
      } else if (!code || state !== expectedState) {
        finish('Authorization failed: missing code or state mismatch. You can close this tab.');
        reject(new Error('Missing code or state mismatch'));
      } else {
        finish('Drive access granted. You can close this tab and return to the terminal.');
        resolvePromise(code);
      }
    });
    server.on('error', reject);
    server.listen(Number(url.port || 80), url.hostname);
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const clientId = readEnvValue(args.project, 'GOOGLE_OAUTH_CLIENT_ID');
  const parentFolderId = readEnvValue(args.project, 'DRIVE_PARENT_FOLDER_ID');

  const secret = gcloud([
    'secrets',
    'versions',
    'access',
    'latest',
    `--secret=${CLIENT_SECRET_NAME}`,
    `--project=${args.project}`,
  ]);
  if (!secret.ok) throw new Error(`Could not read ${CLIENT_SECRET_NAME}: ${secret.stderr}`);
  const clientSecret = secret.stdout.trim();

  const state = base64Url(randomBytes(24));
  const verifier = base64Url(randomBytes(48));
  const challenge = base64Url(createHash('sha256').update(verifier).digest());

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: args.redirectUri,
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    scope: DRIVE_SCOPE,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    ...(args.loginHint ? { login_hint: args.loginHint } : {}),
  });
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

  const codePromise = waitForCode(args.redirectUri, state);
  console.log('[drive-auth] Opening Google consent in your browser.');
  console.log('[drive-auth] Sign in as the owner of the observations parent folder.');
  console.log(`[drive-auth] If it does not open, visit:\n${authUrl}\n`);
  openBrowser(authUrl);
  const code = await codePromise;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: args.redirectUri,
      grant_type: 'authorization_code',
      code_verifier: verifier,
    }),
  });
  const tokens = (await tokenRes.json()) as {
    access_token?: string;
    refresh_token?: string;
    scope?: string;
    error?: string;
    error_description?: string;
  };
  if (!tokenRes.ok || !tokens.access_token) {
    throw new Error(
      `Token exchange failed: ${tokens.error ?? ''} ${tokens.error_description ?? ''}`,
    );
  }
  if (!tokens.refresh_token) throw new Error('Google returned no refresh token.');
  if (!tokens.scope?.split(' ').includes(DRIVE_SCOPE)) {
    throw new Error('The Drive permission was not granted on the consent page.');
  }

  const auth = { Authorization: `Bearer ${tokens.access_token}` };
  const about = (await (
    await fetch('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)', {
      headers: auth,
    })
  ).json()) as { user?: { emailAddress?: string } };
  const folderRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${parentFolderId}?supportsAllDrives=true&fields=name,capabilities(canAddChildren)`,
    { headers: auth },
  );
  const folder = (await folderRes.json()) as {
    name?: string;
    capabilities?: { canAddChildren?: boolean };
  };
  const account = about.user?.emailAddress ?? '(unknown)';
  if (!folderRes.ok || !folder.capabilities?.canAddChildren) {
    throw new Error(
      `${account} cannot add files to parent folder ${parentFolderId}. Nothing was stored.`,
    );
  }
  console.log(`[drive-auth] Authorized as ${account}; can write to "${folder.name ?? ''}".`);

  const exists = gcloud(['secrets', 'describe', SECRET_NAME, `--project=${args.project}`]).ok;
  const store = exists
    ? gcloud(
        ['secrets', 'versions', 'add', SECRET_NAME, '--data-file=-', `--project=${args.project}`],
        tokens.refresh_token,
      )
    : gcloud(
        [
          'secrets',
          'create',
          SECRET_NAME,
          '--replication-policy=automatic',
          '--data-file=-',
          `--project=${args.project}`,
        ],
        tokens.refresh_token,
      );
  if (!store.ok) throw new Error(`Storing ${SECRET_NAME} failed: ${store.stderr}`);
  console.log(
    `[drive-auth] ${exists ? 'Added a new version of' : 'Created'} ${SECRET_NAME} in ${args.project}.`,
  );
  console.log('[drive-auth] Redeploy functions so they pick up the new secret version.');
}

main().catch((err: unknown) => {
  console.error('[drive-auth]', err instanceof Error ? err.message : err);
  process.exit(1);
});
