const TEMPLATE_TOKEN_RE = /^\{\{[a-zA-Z0-9_]+\}\}$/;

// Unicode control characters, zero-width characters, line/paragraph
// separators, and the BOM. Stripping these before validation prevents a
// javascript: (or other unsafe-protocol) href from smuggling itself past
// `new URL()` protocol parsing by hiding behind an invisible character.
// eslint-disable-next-line no-control-regex
const STRIP_RE = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028\u2029\uFEFF]/g;

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

/**
 * Normalizes `value` for use as an href: strips Unicode control/zero-width
 * characters that could otherwise be used to disguise an unsafe protocol
 * (e.g. a zero-width char before `javascript:` that makes
 * `new URL(v, base)` parse it as a relative path instead of recognizing the
 * real protocol), then trims whitespace.
 */
function normalize(value: string): string {
  return value.replace(STRIP_RE, '').trim();
}

/**
 * Returns true when `value` is safe to use as an href -- i.e. it is empty,
 * resolves to an absolute http:, https:, or mailto: URL, or (when
 * `allowTemplateToken` is set) is a single `{{variableName}}` template
 * placeholder. Blocks `javascript:`, `data:`, `vbscript:`, relative paths,
 * and any other non-allowlisted protocol, which is the classic
 * href-injection vector for user-supplied link fields.
 */
export function isSafeUrl(value: string, opts?: { allowTemplateToken?: boolean }): boolean {
  const normalized = normalize(value);
  if (normalized === '') return true;
  if (opts?.allowTemplateToken && TEMPLATE_TOKEN_RE.test(normalized)) return true;
  try {
    // No base: only a fully-qualified absolute URL is accepted, so a
    // disguised relative path (which would otherwise silently resolve
    // against a placeholder base) is rejected outright.
    const parsed = new URL(normalized);
    return ALLOWED_PROTOCOLS.has(parsed.protocol);
  } catch {
    return false;
  }
}

/**
 * Returns the normalized href to store/save for `value`, or `null` when the
 * value is not safe (per `isSafeUrl`). Callers must persist this normalized
 * result -- never the raw input -- so that what was validated is what is
 * saved.
 */
export function toSafeUrl(value: string, opts?: { allowTemplateToken?: boolean }): string | null {
  if (!isSafeUrl(value, opts)) return null;
  return normalize(value);
}
