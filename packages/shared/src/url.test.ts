import { describe, expect, it } from 'vitest';
import { isSafeUrl, sanitizeHtmlHrefs, toSafeUrl } from './url.js';

/** Zero-width space. Built from its code point rather than written inline so
 *  the disguise being tested stays visible in the source. */
const ZWSP = String.fromCharCode(0x200b);
/** NUL, standing in for the C0 control-character range. */
const NUL = String.fromCharCode(0);

describe('isSafeUrl', () => {
  it('allows http and https URLs', () => {
    expect(isSafeUrl('http://example.com')).toBe(true);
    expect(isSafeUrl('https://example.com/path?q=1')).toBe(true);
  });

  it('allows mailto: links', () => {
    expect(isSafeUrl('mailto:someone@example.com')).toBe(true);
  });

  it('allows an empty value', () => {
    expect(isSafeUrl('')).toBe(true);
    expect(isSafeUrl('   ')).toBe(true);
  });

  it('allows a template token only when opted in', () => {
    expect(isSafeUrl('{{signInLink}}', { allowTemplateToken: true })).toBe(true);
    expect(isSafeUrl('{{signInLink}}')).toBe(false);
  });

  it('rejects javascript: URLs', () => {
    expect(isSafeUrl('javascript:alert(1)')).toBe(false);
  });

  it('rejects javascript: regardless of case', () => {
    expect(isSafeUrl('JAVASCRIPT:alert(1)')).toBe(false);
    expect(isSafeUrl('JavaScript:alert(1)')).toBe(false);
  });

  it('rejects data: and vbscript: URLs', () => {
    expect(isSafeUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
    expect(isSafeUrl('vbscript:msgbox(1)')).toBe(false);
  });

  it('rejects a javascript: URL disguised with a leading zero-width space', () => {
    // A zero-width space before the protocol used to make `new URL(v, base)`
    // parse the value as a relative path against the placeholder base,
    // silently passing validation. It must now be stripped and rejected.
    expect(isSafeUrl(ZWSP + 'javascript:alert(1)')).toBe(false);
    expect(isSafeUrl(ZWSP + 'javascript:alert(1)' + ZWSP)).toBe(false);
  });

  it('rejects a javascript: URL disguised with control characters', () => {
    expect(isSafeUrl(NUL + 'javascript:alert(1)')).toBe(false);
    expect(isSafeUrl('java' + NUL + 'script:alert(1)')).toBe(false);
  });

  it('rejects relative paths (no implicit base to resolve against)', () => {
    expect(isSafeUrl('/foo/bar')).toBe(false);
    expect(isSafeUrl('foo/bar')).toBe(false);
  });

  it('treats a bare "https://" as unsafe (no host)', () => {
    expect(isSafeUrl('https://')).toBe(false);
  });
});

describe('toSafeUrl', () => {
  it('returns the normalized href for a safe value', () => {
    expect(toSafeUrl('https://example.com')).toBe('https://example.com');
    expect(toSafeUrl('mailto:someone@example.com')).toBe('mailto:someone@example.com');
  });

  it('normalizes away zero-width/control characters before returning', () => {
    expect(toSafeUrl('  https://example.com  ')).toBe('https://example.com');
  });

  it('returns null for unsafe values', () => {
    expect(toSafeUrl('javascript:alert(1)')).toBeNull();
    expect(toSafeUrl(ZWSP + 'javascript:alert(1)')).toBeNull();
  });

  it('passes an unchanged, already-normalized href straight through', () => {
    const href = 'https://example.com/path';
    expect(toSafeUrl(href)).toBe(href);
  });
});

describe('sanitizeHtmlHrefs', () => {
  it('leaves a body with only safe links untouched', () => {
    const html =
      '<p>Hi <a href="https://example.com">link</a> and <a href="mailto:a@b.com">mail</a>.</p>';
    const result = sanitizeHtmlHrefs(html);
    expect(result.html).toBe(html);
    expect(result.rejected).toEqual([]);
  });

  it('rewrites a javascript: href to # and reports it', () => {
    const result = sanitizeHtmlHrefs('<a href="javascript:alert(1)">click</a>');
    expect(result.html).toBe('<a href="#">click</a>');
    expect(result.rejected).toEqual(['javascript:alert(1)']);
  });

  it('sanitizes single-quoted hrefs', () => {
    const result = sanitizeHtmlHrefs("<a href='javascript:alert(1)'>click</a>");
    expect(result.html).toBe('<a href="#">click</a>');
    expect(result.rejected).toEqual(['javascript:alert(1)']);
  });

  it('sanitizes unquoted hrefs', () => {
    const result = sanitizeHtmlHrefs('<a href=javascript:alert(1)>click</a>');
    expect(result.html).toBe('<a href="#">click</a>');
    expect(result.rejected).toEqual(['javascript:alert(1)']);
  });

  it('matches HREF case-insensitively and tolerates spaces around =', () => {
    const result = sanitizeHtmlHrefs('<a HREF = "javascript:alert(1)">click</a>');
    expect(result.html).toBe('<a href="#">click</a>');
    expect(result.rejected).toEqual(['javascript:alert(1)']);
  });

  it('keeps the safe links in a body that also contains an unsafe one', () => {
    const result = sanitizeHtmlHrefs(
      '<a href="https://ok.com">ok</a><a href="vbscript:msgbox(1)">bad</a>' +
        '<a href="https://also-ok.com">ok</a>',
    );
    expect(result.html).toBe(
      '<a href="https://ok.com">ok</a><a href="#">bad</a><a href="https://also-ok.com">ok</a>',
    );
    expect(result.rejected).toEqual(['vbscript:msgbox(1)']);
  });

  it('rejects an entity-encoded javascript: protocol rather than guessing', () => {
    // Not entity-decoded before validation: it simply fails to parse as an
    // allowlisted absolute URL, so it fails closed.
    const result = sanitizeHtmlHrefs('<a href="&#106;avascript:alert(1)">click</a>');
    expect(result.html).toBe('<a href="#">click</a>');
    expect(result.rejected).toEqual(['&#106;avascript:alert(1)']);
  });

  it('rejects a zero-width-disguised javascript: href', () => {
    const result = sanitizeHtmlHrefs('<a href="' + ZWSP + 'javascript:alert(1)">click</a>');
    expect(result.html).toBe('<a href="#">click</a>');
  });

  it('rejects an unsubstituted template token (tokens resolve before send)', () => {
    const result = sanitizeHtmlHrefs('<a href="{{signInLink}}">sign in</a>');
    expect(result.html).toBe('<a href="#">sign in</a>');
    expect(result.rejected).toEqual(['{{signInLink}}']);
  });

  it('rejects a relative href', () => {
    const result = sanitizeHtmlHrefs('<a href="/admin">admin</a>');
    expect(result.html).toBe('<a href="#">admin</a>');
    expect(result.rejected).toEqual(['/admin']);
  });

  it('leaves an empty href alone', () => {
    const html = '<a href="">nothing</a>';
    expect(sanitizeHtmlHrefs(html).html).toBe(html);
    expect(sanitizeHtmlHrefs(html).rejected).toEqual([]);
  });

  it('does not touch non-href attributes that merely contain the substring', () => {
    const html = '<a data-href="javascript:alert(1)" href="https://ok.com">x</a>';
    const result = sanitizeHtmlHrefs(html);
    expect(result.html).toBe(html);
    expect(result.rejected).toEqual([]);
  });

  it('preserves other attributes on a sanitized anchor', () => {
    const result = sanitizeHtmlHrefs(
      '<a href="javascript:alert(1)" style="color:red" data-cta="true">x</a>',
    );
    expect(result.html).toBe('<a href="#" style="color:red" data-cta="true">x</a>');
  });

  it('returns an empty rejected list for HTML with no links at all', () => {
    const html = '<p>Just text.</p>';
    const result = sanitizeHtmlHrefs(html);
    expect(result.html).toBe(html);
    expect(result.rejected).toEqual([]);
  });
});
