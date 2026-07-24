const TEMPLATE_TOKEN_RE = /^\{\{[a-zA-Z0-9_]+\}\}$/;

/**
 * Returns true when `value` is safe to use as an href — i.e. it resolves to
 * an http(s) URL (absolute or relative), is empty, or (when
 * `allowTemplateToken` is set) is a single `{{variableName}}` template
 * placeholder. Blocks `javascript:`, `data:`, `vbscript:`, and any other
 * non-http(s) protocol, which is the classic href-injection vector for
 * user-supplied link fields.
 */
export function isSafeUrl(value: string, opts?: { allowTemplateToken?: boolean }): boolean {
  const trimmed = value.trim();
  if (trimmed === '') return true;
  if (opts?.allowTemplateToken && TEMPLATE_TOKEN_RE.test(trimmed)) return true;
  try {
    const parsed = new URL(trimmed, 'https://placeholder.invalid');
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}
