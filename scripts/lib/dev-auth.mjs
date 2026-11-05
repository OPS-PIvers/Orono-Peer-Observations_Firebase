// Shared by scripts/dev-auth-server.mjs and the Vite dev proxy
// (apps/web/vite-dev-auth-proxy.ts) that forwards /__dev-auth/mint to it.

import os from 'node:os';
import path from 'node:path';

/** Request header that carries the per-run secret from the Vite proxy. */
export const DEV_AUTH_SECRET_HEADER = 'x-dev-auth-secret';

/** Where the running server leaves its secret for the Vite proxy to read. */
export function devAuthSecretPath(port) {
  return path.join(os.tmpdir(), `ops-dev-auth-${String(port)}.secret`);
}

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

/** True when a Host header names a loopback address (any port). */
export function isLoopbackHost(host) {
  if (typeof host !== 'string' || host.length === 0) return false;
  try {
    return LOOPBACK_HOSTNAMES.has(new URL(`http://${host}`).hostname);
  } catch {
    return false;
  }
}

/** Browser origins the local Vite dev server runs on. */
export const ALLOWED_DEV_ORIGINS = new Set([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://[::1]:5173',
]);

export function isAllowedDevOrigin(origin) {
  return ALLOWED_DEV_ORIGINS.has(origin);
}
