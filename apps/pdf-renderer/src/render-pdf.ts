import type { Browser } from 'puppeteer';

/**
 * Print-page lockdown for the archived observation PDF.
 *
 * The page prints content that observed teachers and observers wrote, so it
 * runs with JavaScript off and may not fetch anything: every request other
 * than the document itself and `data:` URLs is aborted. The one remote asset
 * the template used to load, the branding logo, is fetched here by the
 * server and inlined as a `data:` URL before rendering (see `inlineLogo`).
 */

const LOGO_FETCH_TIMEOUT_MS = 5_000;
const LOGO_MAX_BYTES = 2 * 1024 * 1024;

/** Request URLs the print page may load. The document itself is `about:blank`
 *  (setContent writes into it); fonts and the logo are `data:` URLs. */
export function isAllowedPrintRequest(url: string): boolean {
  return url.startsWith('data:') || url === 'about:blank';
}

/**
 * Fetch the admin-configured branding logo and return it as a `data:` URL.
 * Returns null (no logo, PDF still renders) when the URL isn't http(s), the
 * fetch fails or times out, the response isn't an image, or it's too large.
 */
export async function inlineLogo(
  logoUrl: string | null | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const url = logoUrl?.trim();
  if (!url) return null;
  if (url.startsWith('data:image/')) return url;
  if (!/^https?:\/\//i.test(url)) return null;
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(LOGO_FETCH_TIMEOUT_MS) });
    if (!res.ok) {
      console.warn(`[pdf-renderer] logo fetch failed: HTTP ${String(res.status)}`);
      return null;
    }
    const contentType = (res.headers.get('content-type') ?? '').split(';')[0]?.trim() ?? '';
    if (!contentType.startsWith('image/')) {
      console.warn(`[pdf-renderer] logo is not an image (${contentType || 'no content-type'})`);
      return null;
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.byteLength > LOGO_MAX_BYTES) {
      console.warn(`[pdf-renderer] logo too large (${String(bytes.byteLength)} bytes)`);
      return null;
    }
    return `data:${contentType};base64,${bytes.toString('base64')}`;
  } catch (err) {
    console.warn('[pdf-renderer] logo fetch failed:', err);
    return null;
  }
}

/** Print `html` to a Letter PDF on a page with JavaScript off and all
 *  outside requests blocked. */
export async function renderPdf(browser: Browser, html: string): Promise<Uint8Array> {
  const page = await browser.newPage();
  try {
    await page.setJavaScriptEnabled(false);
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      if (isAllowedPrintRequest(request.url())) void request.continue();
      else void request.abort('blockedbyclient');
    });
    // 'load' waits for the inlined logo image to decode, so it isn't blank.
    await page.setContent(html, { waitUntil: 'load' });
    return await page.pdf({
      format: 'Letter',
      printBackground: true,
      margin: { top: '0.6in', bottom: '0.6in', left: '0.6in', right: '0.6in' },
    });
  } finally {
    await page.close();
  }
}
