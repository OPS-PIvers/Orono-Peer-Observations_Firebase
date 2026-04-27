import { serve } from '@hono/node-server';
import { Hono } from 'hono';

/**
 * Cloud Run PDF renderer — Phase 1 stub.
 *
 * Phase 6 will:
 *   - Verify caller (Firebase Auth ID token via firebase-admin)
 *   - Read observation from Firestore
 *   - Render an HTML template (React-to-string for PDF) with rubric content
 *   - Launch a headless Chromium with Puppeteer (singleton; reused across
 *     requests within a container instance), print to PDF
 *   - Return PDF buffer
 *
 * For now, just a healthcheck so Cloud Build / smoke tests have something
 * to verify against.
 */

const app = new Hono();

app.get('/', (c) => c.text('OPS Peer Observations — PDF renderer ready.'));
app.get('/healthz', (c) => c.json({ status: 'ok', service: 'pdf-renderer' }));

const port = Number(process.env['PORT'] ?? 8080);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[pdf-renderer] listening on :${info.port}`);
});
