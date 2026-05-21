import type { TiptapDoc } from '@ops/shared';

/** Parse a stored module section `body` (JSON-serialized TiptapDoc) back into a
 *  TiptapDoc. Returns undefined for empty or non-JSON content. */
export function parseTiptapBody(body: string): TiptapDoc | undefined {
  if (!body.trim()) return undefined;
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed === 'object' && parsed !== null && 'type' in parsed) {
      return parsed as TiptapDoc;
    }
  } catch {
    // not JSON — treat as empty
  }
  return undefined;
}
