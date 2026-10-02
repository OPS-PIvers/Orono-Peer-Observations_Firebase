/**
 * Preloaded (via NODE_OPTIONS=--import) in Claude Code cloud sessions only.
 *
 * Those sessions send outbound HTTPS through an agent proxy set in
 * HTTPS_PROXY, with local addresses listed in NO_PROXY. firebase-tools reads
 * HTTPS_PROXY but ignores NO_PROXY, so the Functions emulator's calls to the
 * other emulators on 127.0.0.1 go to the proxy, which rejects them, and
 * `emulators:exec` dies with "Unable to parse JSON ... request bl[ocked]".
 *
 * Swap firebase-tools' undici ProxyAgent for EnvHttpProxyAgent, which reads
 * the same HTTPS_PROXY but honours NO_PROXY. Outbound traffic still goes
 * through the proxy; only local emulator traffic stays local. A no-op when
 * firebase-tools isn't installed.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

try {
  const firebaseTools = require.resolve('firebase-tools/package.json');
  const undici = require(require.resolve('undici', { paths: [firebaseTools] }));
  if (undici.EnvHttpProxyAgent && !undici.__opsNoProxyShim) {
    const EnvHttpProxyAgent = undici.EnvHttpProxyAgent;
    undici.ProxyAgent = class extends EnvHttpProxyAgent {
      constructor() {
        super();
      }
    };
    undici.__opsNoProxyShim = true;
  }
} catch {
  // firebase-tools not installed yet; nothing to patch.
}
