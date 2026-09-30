import { describe, expect, it } from 'vitest';
import {
  MAX_PDF_ATTACHMENT_BYTES,
  acknowledgeBlockHtml,
  acknowledgeLinkFor,
  pdfAttachment,
  reportFileName,
} from './acknowledgeEmail.js';

describe('acknowledgeLinkFor', () => {
  it('points at the observation with the ack prompt flag', () => {
    expect(acknowledgeLinkFor('https://app.example', 'obs 1')).toBe(
      'https://app.example/observations/obs%201?ack=1',
    );
  });
});

describe('pdfAttachment', () => {
  it('attaches a PDF that fits, base64-encoded', () => {
    const att = pdfAttachment(Buffer.from('%PDF-1.7'), 'r.pdf');
    expect(att).toEqual({
      filename: 'r.pdf',
      content: Buffer.from('%PDF-1.7').toString('base64'),
      encoding: 'base64',
      contentType: 'application/pdf',
    });
  });

  it('refuses an empty or oversized PDF so the email links instead', () => {
    expect(pdfAttachment(Buffer.alloc(0), 'r.pdf')).toBeNull();
    expect(pdfAttachment(Buffer.alloc(MAX_PDF_ATTACHMENT_BYTES + 1), 'r.pdf')).toBeNull();
  });

  it('keeps the base64 attachment well under the 1 MiB /mail doc limit', () => {
    const att = pdfAttachment(Buffer.alloc(MAX_PDF_ATTACHMENT_BYTES), 'r.pdf');
    expect(att?.content.length ?? 0).toBeLessThan(900 * 1024);
  });
});

describe('reportFileName', () => {
  it('names the report after the staff member', () => {
    expect(reportFileName("Jane O'Doe")).toBe("Jane O'Doe - Observation Report.pdf");
    expect(reportFileName('A/B: "C"')).toBe('A B C - Observation Report.pdf');
    expect(reportFileName('')).toBe('Observation - Observation Report.pdf');
  });
});

describe('acknowledgeBlockHtml', () => {
  const link = 'https://app.example/observations/o1?ack=1';

  it('has the Acknowledge receipt button', () => {
    const html = acknowledgeBlockHtml({ acknowledgeLink: link, pdfLink: null, pdfAttached: true });
    expect(html).toContain(`href="${link}"`);
    expect(html).toContain('Acknowledge receipt');
    expect(html).toContain('attached');
  });

  it('links to the PDF when it is not attached', () => {
    const html = acknowledgeBlockHtml({
      acknowledgeLink: link,
      pdfLink: 'https://drive.google.com/file/d/f1/view',
      pdfAttached: false,
    });
    expect(html).toContain('href="https://drive.google.com/file/d/f1/view"');
    expect(html).not.toContain('attached');
  });

  it('escapes the links', () => {
    const html = acknowledgeBlockHtml({
      acknowledgeLink: 'https://x/?a=1&b="2"',
      pdfLink: null,
      pdfAttached: false,
    });
    expect(html).toContain('https://x/?a=1&amp;b=&quot;2&quot;');
  });
});
