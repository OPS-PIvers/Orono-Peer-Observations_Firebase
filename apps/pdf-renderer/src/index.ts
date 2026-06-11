import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import puppeteer, { type Browser } from 'puppeteer';
import { renderObservationHtml, type RenderPayload } from './template.js';

/**
 * Cloud Run PDF renderer.
 *
 * Sole consumer is the `finalizeObservation` Cloud Function. The function
 * fetches the observation + rubric data with the Admin SDK (bypasses
 * security rules), POSTs the payload here, and we return a PDF buffer.
 *
 * Auth between services uses Cloud Run IAM: the Cloud Function's service
 * account has `roles/run.invoker` on this service. Cloud Run validates the
 * incoming identity token before our handler runs, so we don't need
 * application-level auth.
 *
 * Puppeteer's headless Chromium is launched lazily on first request and
 * cached in a module-level singleton to avoid the ~1s startup cost on
 * every invocation. The browser persists across requests within a
 * container instance. Failure recovery matters here: a rejected launch is
 * never cached (the next request retries), and a browser that crashes
 * after launch is detected via `connected` and relaunched. Without that,
 * one bad launch would 500 every finalization until Cloud Run happened to
 * recycle the instance.
 */

/**
 * Per-step Puppeteer timeout. Cloud Run already bounds the whole request at
 * 120s; an explicit budget keeps a wedged page from pinning the instance
 * that long.
 */
const RENDER_TIMEOUT_MS = 60_000;

export const app = new Hono();

// Without this, failures surface as Hono's default opaque 500 and the
// calling function can only report a generic "PDF rendering failed." Log
// the real cause for Cloud Run logs and return structured JSON so the
// function's logs identify it too.
app.onError((err, c) => {
  console.error('[pdf-renderer] request failed:', err);
  return c.json({ error: 'render_failed', message: err.message }, 500);
});

app.get('/', (c) => c.text('OPS Peer Observations — PDF renderer ready.'));
app.get('/healthz', (c) => c.json({ status: 'ok', service: 'pdf-renderer' }));

app.post('/render-observation', async (c) => {
  const payload = await c.req.json<RenderPayload>();
  const html = renderObservationHtml(payload);
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: RENDER_TIMEOUT_MS });
    const pdf = await page.pdf({
      format: 'Letter',
      printBackground: true,
      margin: { top: '0.6in', bottom: '0.6in', left: '0.6in', right: '0.6in' },
      timeout: RENDER_TIMEOUT_MS,
    });
    return new Response(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="observation-${encodeURIComponent(payload.observation.observationId)}.pdf"`,
      },
    });
  } finally {
    await page.close();
  }
});

let browserPromise: Promise<Browser> | null = null;

function launchBrowser(): Promise<Browser> {
  // The first three flags below are required to run inside a non-root
  // container without /dev/shm. The fourth keeps Chromium from auto-fetching
  // unrelated network resources we don't need for static templates.
  const launching = puppeteer
    .launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--font-render-hinting=none',
      ],
    })
    .catch((error: unknown) => {
      // A failed launch (transient OOM, cold-start race) must not poison the
      // singleton: clear it so the next request retries instead of rejecting
      // forever. Guarded so a newer launch attempt is never clobbered.
      if (browserPromise === launching) {
        browserPromise = null;
      }
      throw error;
    });
  browserPromise = launching;
  return launching;
}

/**
 * Resolve the shared Chromium instance, launching (or relaunching) it as
 * needed. Exported for unit tests, which mock `puppeteer.launch`.
 */
export async function getBrowser(): Promise<Browser> {
  const cached = browserPromise ?? launchBrowser();
  const browser = await cached;
  if (browser.connected) {
    return browser;
  }
  // Chromium died after a successful launch (OOM kill, renderer crash):
  // every newPage() on the stale handle would throw. Drop the singleton —
  // unless a concurrent request already replaced it — and launch a fresh
  // browser.
  if (browserPromise === cached) {
    browserPromise = null;
  }
  return browserPromise ?? launchBrowser();
}

const port = Number(process.env['PORT'] ?? 8080);

// Vitest imports this module to exercise `app` and `getBrowser` directly;
// only bind the port when running as the real service.
if (!process.env['VITEST']) {
  serve({ fetch: app.fetch, port }, (info) => {
    console.log(`[pdf-renderer] listening on :${String(info.port)}`);
  });
}
