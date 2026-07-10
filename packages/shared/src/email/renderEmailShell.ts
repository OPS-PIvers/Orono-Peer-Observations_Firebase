/**
 * Wrap a template body (the admin-edited content HTML) in a branded,
 * email-client-safe shell: white card on a light page, logo header, footer.
 *
 * Pure string builder — safe to call from both the Cloud Functions backend
 * (at send time) and the web admin preview. The body is trusted HTML from the
 * template editor and is inserted as-is; only the small dynamic header/footer
 * strings are escaped.
 */

export interface EmailShellOptions {
  appName: string;
  /** Absolute, publicly-reachable logo URL. Falsy → app-name wordmark header. */
  logoUrl?: string | null;
  /** Optional sign-in URL rendered in the footer. */
  signInLink?: string | null;
  /** Optional link to the recipient's email-preferences section (Profile
   *  page). Rendered in the footer next to the sign-in link so non-critical
   *  mail always carries a self-service opt-out path. */
  preferencesLink?: string | null;
}

const BLUE = '#2d3f89';
const BLUE_DARK = '#1d2a5d';

/** Inline styles for an email CTA button (works in Gmail/Apple Mail/mobile;
 *  degrades to a colored link in legacy Outlook). Shared by the editor's
 *  CtaButton node and the seeded template bodies so they stay consistent. */
export const EMAIL_BUTTON_STYLE =
  `background:${BLUE};color:#ffffff;text-decoration:none;` +
  `font-family:'Lexend',Arial,sans-serif;font-weight:600;font-size:15px;` +
  `padding:12px 24px;border-radius:6px;display:inline-block;`;

/** Build an email-safe CTA button anchor. `href` may contain `{{tokens}}`. */
export function emailButtonHtml(href: string, label: string): string {
  return `<a href="${href}" data-cta="true" style="${EMAIL_BUTTON_STYLE}">${label}</a>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderEmailShell(bodyHtml: string, opts: EmailShellOptions): string {
  const appName = escapeHtml(opts.appName);
  const header = opts.logoUrl
    ? `<img src="${escapeHtml(opts.logoUrl)}" alt="${appName}" height="44" style="display:block;max-height:44px;width:auto;border:0;outline:none;text-decoration:none;" />`
    : `<span style="font-family:'Lexend',Arial,sans-serif;font-size:20px;font-weight:700;color:${BLUE_DARK};">${appName}</span>`;

  const footerLink = opts.signInLink
    ? ` &middot; <a href="${escapeHtml(opts.signInLink)}" style="color:#cdd3e8;">Sign in</a>`
    : '';
  const preferencesLink = opts.preferencesLink
    ? ` &middot; <a href="${escapeHtml(opts.preferencesLink)}" style="color:#cdd3e8;">Email preferences</a>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  @import url('https://fonts.googleapis.com/css2?family=Lexend:wght@500;600;700&family=Roboto:wght@400;500;700&display=swap');
  body { margin:0; padding:0; background:#f3f3f3; -webkit-font-smoothing:antialiased; }
  .email-body p { margin:0 0 14px; }
  .email-body h1, .email-body h2, .email-body h3 { font-family:'Lexend',Arial,sans-serif; color:${BLUE_DARK}; margin:0 0 12px; line-height:1.25; }
  .email-body a { color:${BLUE}; }
  .email-body ul, .email-body ol { margin:0 0 14px; padding-left:22px; }
</style>
</head>
<body style="margin:0;padding:0;background:#f3f3f3;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f3f3;">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:#ffffff;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
          <tr>
            <td style="padding:22px 32px;border-bottom:3px solid ${BLUE};background:#ffffff;">
              ${header}
            </td>
          </tr>
          <tr>
            <td class="email-body" style="padding:28px 32px;font-family:'Roboto',Arial,sans-serif;font-size:15px;line-height:1.6;color:#333333;">
              ${bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:18px 32px;background:${BLUE_DARK};color:#cdd3e8;font-family:'Roboto',Arial,sans-serif;font-size:12px;line-height:1.5;">
              <strong style="color:#ffffff;">${appName}</strong><br />
              Orono Public Schools${footerLink}${preferencesLink}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
