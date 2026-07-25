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

/** Matches an `href` attribute in either quoting style, or unquoted. The
 *  leading whitespace is part of the match so the replacement can restore a
 *  single separating space. */
const HREF_ATTR_RE = /\s+href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;

/** Result of {@link sanitizeHtmlHrefs}. */
export interface HrefSanitizeResult {
  /** The HTML with every unsafe href rewritten to `#`. */
  html: string;
  /** The raw attribute values that were rejected, for logging/auditing.
   *  Empty when the input was already clean. */
  rejected: string[];
}

/**
 * Rewrites every `href` in `html` that is not a safe absolute http/https/
 * mailto URL to `#`, and reports what was rejected.
 *
 * This is the send-time counterpart to input-time validation. `toSafeUrl`
 * guards what the link editor writes, but a stored template body predating
 * that validation -- or one written by any path that bypasses the editor --
 * is still untrusted when it is finally rendered into an outbound email.
 * Validating again here means the trust boundary sits at the send, not at
 * whichever write happened to create the value.
 *
 * Attribute values are checked exactly as they appear, with no entity
 * decoding: anything that does not parse as an allowlisted absolute URL is
 * rejected, so entity-encoded or otherwise mangled protocols
 * (`&#106;avascript:`) fail closed rather than being guessed at.
 *
 * Template tokens are deliberately *not* allowed. Callers substitute
 * variables before sending, so a surviving `{{token}}` in an href is an
 * unresolved value rather than a legitimate placeholder.
 */
export function sanitizeHtmlHrefs(html: string): HrefSanitizeResult {
  const rejected: string[] = [];
  const cleaned = html.replace(
    HREF_ATTR_RE,
    (match: string, doubleQuoted?: string, singleQuoted?: string, unquoted?: string) => {
      const raw = doubleQuoted ?? singleQuoted ?? unquoted ?? '';
      if (isSafeUrl(raw)) return match;
      rejected.push(raw);
      return ' href="#"';
    },
  );
  return { html: cleaned, rejected };
}
