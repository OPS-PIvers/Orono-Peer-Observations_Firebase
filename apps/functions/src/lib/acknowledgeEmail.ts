import { emailButtonHtml } from '@ops/shared';
import type { EmailAttachment } from './emailUtils.js';

/**
 * Pieces of the finalized-observation email (and its reminder) that ask the
 * observed staff member to confirm receipt. Kept out of the admin-editable
 * template so the button is always there: sendTemplatedEmail appends
 * `acknowledgeBlockHtml` unless the template already places
 * `{{acknowledgeLink}}` itself.
 */

/**
 * Largest PDF attached to the email. The Trigger Email extension reads the
 * attachment from the /mail doc, which Firestore caps at 1 MiB; base64 adds a
 * third, and the HTML body needs room too. Bigger reports are linked instead.
 */
export const MAX_PDF_ATTACHMENT_BYTES = 600 * 1024;

/** Deep link that signs the staff member in and opens the confirm prompt. */
export function acknowledgeLinkFor(appUrl: string, observationId: string): string {
  return `${appUrl}/observations/${encodeURIComponent(observationId)}?ack=1`;
}

/** The report PDF as an email attachment, or null when it's too large to
 *  attach (the email then links to it instead). */
export function pdfAttachment(pdf: Buffer, fileName: string): EmailAttachment | null {
  if (pdf.length === 0 || pdf.length > MAX_PDF_ATTACHMENT_BYTES) return null;
  return {
    filename: fileName,
    content: pdf.toString('base64'),
    encoding: 'base64',
    contentType: 'application/pdf',
  };
}

/** `Jane Doe - Observation Report.pdf`, with characters mail clients choke on
 *  removed. */
export function reportFileName(observedName: string): string {
  const name =
    observedName
      .replace(/[^\p{L}\p{N} .'-]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim() || 'Observation';
  return `${name} - Observation Report.pdf`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * The "Acknowledge receipt" call to action. When the PDF isn't attached
 * (too large, or not available) the block also links to it in Drive.
 */
export function acknowledgeBlockHtml(args: {
  acknowledgeLink: string;
  pdfLink: string | null;
  pdfAttached: boolean;
}): string {
  const report = args.pdfAttached
    ? '<p>Your observation report is attached as a PDF.</p>'
    : args.pdfLink
      ? `<p>View your observation report: <a href="${escapeHtml(args.pdfLink)}">Open the PDF</a></p>`
      : '';
  return `${report}
<p>Please confirm that you received your observation. You'll be asked to sign in first.</p>
<p style="text-align:center;margin:26px 0;">${emailButtonHtml(escapeHtml(args.acknowledgeLink), 'Acknowledge receipt')}</p>`;
}
