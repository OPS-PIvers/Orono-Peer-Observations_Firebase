/**
 * Minimal hand-written CSV serializer for the export script — deliberately
 * no dependency, mirroring apps/web/src/admin/staff/staffCsv.ts's
 * csvEscapeField/csvSerializeRow (kept in sync by hand rather than shared,
 * since that file also carries browser-only download/import logic and
 * lives in a package this Node script doesn't build against).
 */

/** Quote a single CSV field per RFC 4180 whenever it contains a comma,
 *  quote, or newline; embedded quotes are doubled. */
export function csvEscapeField(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function csvSerializeRow(fields: readonly string[]): string {
  return fields.map(csvEscapeField).join(',');
}

/** Serialize a full CSV document (header + rows) with CRLF line endings. */
export function csvSerializeDocument(header: readonly string[], rows: readonly string[][]): string {
  const lines = [csvSerializeRow(header), ...rows.map((r) => csvSerializeRow(r))];
  return lines.join('\r\n') + '\r\n';
}
