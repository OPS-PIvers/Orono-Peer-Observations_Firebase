import { describe, expect, it } from 'vitest';
import { isSafeUrl, toSafeUrl } from './url';

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
    expect(isSafeUrl('\u200Bjavascript:alert(1)')).toBe(false);
    expect(isSafeUrl('\u200Bjavascript:alert(1)\u200B')).toBe(false);
  });

  it('rejects a javascript: URL disguised with control characters', () => {
    expect(isSafeUrl('\u0000javascript:alert(1)')).toBe(false);
    expect(isSafeUrl('java\u0000script:alert(1)')).toBe(false);
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
    expect(toSafeUrl('\u200Bjavascript:alert(1)')).toBeNull();
  });

  it('passes an unchanged, already-normalized href straight through', () => {
    const href = 'https://example.com/path';
    expect(toSafeUrl(href)).toBe(href);
  });
});
