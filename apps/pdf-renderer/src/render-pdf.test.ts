import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Browser } from 'puppeteer';
import { inlineLogo, isAllowedPrintRequest, renderPdf } from './render-pdf.js';

function fakeFetch(body: Uint8Array | string, init: ResponseInit): typeof fetch {
  return vi.fn(() => Promise.resolve(new Response(body, init)));
}

describe('isAllowedPrintRequest', () => {
  it('allows only data: URLs and the blank document', () => {
    expect(isAllowedPrintRequest('data:image/png;base64,AAAA')).toBe(true);
    expect(isAllowedPrintRequest('about:blank')).toBe(true);
    expect(isAllowedPrintRequest('https://attacker.example/b')).toBe(false);
    expect(isAllowedPrintRequest('http://169.254.169.254/')).toBe(false);
    expect(isAllowedPrintRequest('file:///etc/passwd')).toBe(false);
  });
});

describe('inlineLogo', () => {
  it('returns null for a missing or non-http URL without fetching', async () => {
    const fetchImpl = fakeFetch('', { status: 200 });
    expect(await inlineLogo(null, fetchImpl)).toBeNull();
    expect(await inlineLogo('  ', fetchImpl)).toBeNull();
    expect(await inlineLogo('file:///etc/passwd', fetchImpl)).toBeNull();
    expect(await inlineLogo('javascript:alert(1)', fetchImpl)).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('passes an image data: URL through', async () => {
    expect(await inlineLogo('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
  });

  it('inlines an image response as a data: URL', async () => {
    const png = new Uint8Array([137, 80, 78, 71]);
    const result = await inlineLogo(
      'https://example.com/logo.png',
      fakeFetch(png, { status: 200, headers: { 'content-type': 'image/png' } }),
    );
    expect(result).toBe(`data:image/png;base64,${Buffer.from(png).toString('base64')}`);
  });

  it('returns null for an error status, a non-image, or a fetch failure', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const url = 'https://example.com/logo.png';
    expect(await inlineLogo(url, fakeFetch('x', { status: 404 }))).toBeNull();
    expect(
      await inlineLogo(
        url,
        fakeFetch('<html>', { status: 200, headers: { 'content-type': 'text/html' } }),
      ),
    ).toBeNull();
    const failing = vi.fn(() => Promise.reject(new Error('boom'))) as unknown as typeof fetch;
    expect(await inlineLogo(url, failing)).toBeNull();
  });
});

// Real-Chromium check of the print-page lockdown. Runs when a Chromium is
// available (PUPPETEER_EXECUTABLE_PATH, as in the cloud dev container).
const chromePath = process.env['PUPPETEER_EXECUTABLE_PATH'];
describe.skipIf(!chromePath)('renderPdf lockdown', () => {
  let browser: Browser;

  beforeAll(async () => {
    const puppeteer = (await import('puppeteer')).default;
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
  });

  afterAll(async () => {
    await browser.close();
  });

  it('makes no outside request and still prints data: images', async () => {
    // A local server stands in for an attacker URL; it must see no hits.
    const hits: string[] = [];
    const server = createServer((req, res) => {
      hits.push(req.url ?? '');
      res.end('x');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    const origin = `http://127.0.0.1:${String(port)}`;
    const pixel =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const html = `<!doctype html><html><head>
      <link rel="stylesheet" href="${origin}/css" />
      </head><body>
      <img src="${pixel}" />
      <img src="${origin}/img" />
      <mark style="background-image:url(${origin}/bg)">x</mark>
      <script>fetch('${origin}/js');</script>
      <p>Rendered.</p>
    </body></html>`;
    try {
      const pdf = await renderPdf(browser, html);
      expect(Buffer.from(pdf.slice(0, 5)).toString()).toBe('%PDF-');
      expect(hits).toEqual([]);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }, 30_000);
});
