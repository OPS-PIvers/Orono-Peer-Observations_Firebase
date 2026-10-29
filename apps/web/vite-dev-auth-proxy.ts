import { readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import {
  DEV_AUTH_SECRET_HEADER,
  devAuthSecretPath,
  isLoopbackHost,
} from '../../scripts/lib/dev-auth.mjs';

export const DEV_AUTH_PROXY_PATH = '/__dev-auth/mint';

const MAX_BODY_BYTES = 4096;

/**
 * Dev-server-only proxy for the /dev-sign-in page. The page POSTs
 * same-origin to /__dev-auth/mint; this forwards the body to
 * scripts/dev-auth-server.mjs with the per-run secret that server left in
 * the OS temp dir. The secret never reaches the browser, and requests from
 * any other origin are refused before anything is forwarded.
 */
export function devAuthProxy(target: string): Plugin {
  const targetUrl = new URL(target);
  const secretFile = devAuthSecretPath(targetUrl.port || '80');

  function readSecret(): string | null {
    const fromEnv = process.env['DEV_AUTH_SECRET'];
    if (fromEnv) return fromEnv;
    try {
      return readFileSync(secretFile, 'utf8').trim() || null;
    } catch {
      return null;
    }
  }

  function send(res: ServerResponse, status: number, body: unknown): void {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(body));
  }

  function isSameOriginRequest(req: IncomingMessage): boolean {
    const host = req.headers.host;
    if (!isLoopbackHost(host)) return false;
    const site = req.headers['sec-fetch-site'];
    if (site !== undefined && site !== 'same-origin') return false;
    const origin = req.headers.origin;
    return origin === undefined || origin === `http://${host ?? ''}`;
  }

  async function readBody(req: IncomingMessage): Promise<string | null> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      size += buf.length;
      if (size > MAX_BODY_BYTES) return null;
      chunks.push(buf);
    }
    return Buffer.concat(chunks).toString('utf8');
  }

  return {
    name: 'ops-dev-auth-proxy',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(DEV_AUTH_PROXY_PATH, (req, res) => {
        void (async () => {
          if (req.method !== 'POST') {
            send(res, 405, { error: 'POST only' });
            return;
          }
          if (!isSameOriginRequest(req)) {
            send(res, 403, { error: 'Cross-origin requests are not allowed' });
            return;
          }
          if (!(req.headers['content-type'] ?? '').startsWith('application/json')) {
            send(res, 415, { error: 'Content-Type must be application/json' });
            return;
          }
          const secret = readSecret();
          if (!secret) {
            send(res, 503, { error: 'dev-auth-server is not running' });
            return;
          }
          const body = await readBody(req);
          if (body === null) {
            send(res, 413, { error: 'Body too large' });
            return;
          }
          try {
            const upstream = await fetch(new URL('/mint', targetUrl), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', [DEV_AUTH_SECRET_HEADER]: secret },
              body,
            });
            res.statusCode = upstream.status;
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Cache-Control', 'no-store');
            res.end(await upstream.text());
          } catch {
            send(res, 502, { error: 'dev-auth-server is not reachable' });
          }
        })();
      });
    },
  };
}
