// Polls the dev-auth-server's /health endpoint until it responds or a hard
// timeout elapses. Used in CI right after starting the server in the
// background — without this, a broken/slow server would let the e2e run
// proceed and silently fall back to test.skip() for every auth-dependent
// spec, producing a false-green run.
//
// Env:
//   DEV_AUTH_PORT   — port to poll (default 8787, matches dev-auth-server.mjs)
//   WAIT_TIMEOUT_MS — hard timeout in ms (default 30000)

const PORT = Number(process.env.DEV_AUTH_PORT ?? '8787');
const URL = `http://127.0.0.1:${PORT}/health`;
const TIMEOUT_MS = Number(process.env.WAIT_TIMEOUT_MS ?? '30000');
const POLL_INTERVAL_MS = 500;

const deadline = Date.now() + TIMEOUT_MS;

async function poll() {
  while (Date.now() < deadline) {
    try {
      const res = await fetch(URL);
      if (res.ok) {
        console.log(`[wait-for-dev-auth-server] ready at ${URL}`);
        return;
      }
    } catch {
      // not up yet — keep polling
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  console.error(
    `[wait-for-dev-auth-server] dev-auth-server did not become ready at ${URL} within ${TIMEOUT_MS}ms`,
  );
  process.exit(1);
}

await poll();
