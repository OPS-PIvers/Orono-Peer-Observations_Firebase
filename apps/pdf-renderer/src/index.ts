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
 * container instance.
 */

const app = new Hono();

app.get('/', (c) => c.text('OPS Peer Observations — PDF renderer ready.'));
app.get('/healthz', (c) => c.json({ status: 'ok', service: 'pdf-renderer' }));

app.post('/render-observation', async (c) => {
  const payload = await c.req.json<RenderPayload>();
  const html = renderObservationHtml(payload);
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({
      format: 'Letter',
      printBackground: true,
      margin: { top: '0.6in', bottom: '0.6in', left: '0.6in', right: '0.6in' },
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

async function getBrowser(): Promise<Browser> {
  // The first three flags below are required to run inside a non-root
  // container without /dev/shm. The fourth keeps Chromium from auto-fetching
  // unrelated network resources we don't need for static templates.
  //
  // If launch fails, or the browser later crashes/disconnects, reset the
  // cached promise so the *next* request gets a fresh launch instead of a
  // poisoned singleton that fails every request until the container recycles.
  browserPromise ??= puppeteer
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
    .then((browser) => {
      browser.on('disconnected', () => {
        browserPromise = null;
      });
      return browser;
    })
    .catch((err: unknown) => {
      browserPromise = null;
      throw err;
    });
  return browserPromise;
}

const port = Number(process.env['PORT'] ?? 8080);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[pdf-renderer] listening on :${String(info.port)}`);
});
