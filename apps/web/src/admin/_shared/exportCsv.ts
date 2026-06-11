/**
 * CSV export utilities for admin tables.
 *
 * Handles escaping, quoting, and BOM for Excel compatibility.
 */

/**
 * Escape a field value for CSV: if it contains quotes, commas, or newlines,
 * wrap in double quotes and double any internal quotes.
 */
export function escapeCSVField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Convert a row object to a CSV line.
 * @param row Object with string values
 * @param keys Field names in order
 * @returns CSV line string
 */
export function rowToCSV(row: Record<string, string>, keys: string[]): string {
  return keys.map((k) => escapeCSVField(row[k] ?? '')).join(',');
}

/**
 * Generate a complete CSV document from rows and headers.
 * Includes BOM for Excel UTF-8 compatibility.
 *
 * @param rows Array of row objects
 * @param headers Column headers
 * @param keys Field names in order
 * @returns CSV string with UTF-8 BOM
 */
export function generateCSV(
  rows: Record<string, string>[],
  headers: string[],
  keys: string[],
): string {
  const lines: string[] = [];

  // UTF-8 BOM for Excel
  const headerMap: Record<string, string> = {};
  for (let i = 0; i < headers.length; i++) {
    const key = keys[i];
    if (key !== undefined) {
      headerMap[key] = headers[i] ?? '';
    }
  }
  lines.push('﻿' + rowToCSV(headerMap, keys));

  for (const row of rows) {
    lines.push(rowToCSV(row, keys));
  }

  return lines.join('\n');
}

/**
 * Trigger a browser download of a CSV file.
 * @param csv CSV content
 * @param filename File name (without directory)
 */
export function downloadCSV(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Export rows to a CSV file and trigger download.
 * @param rows Array of row objects
 * @param headers Column headers
 * @param keys Field names in order
 * @param filename File name (without directory)
 */
export function exportToCSV(
  rows: Record<string, string>[],
  headers: string[],
  keys: string[],
  filename: string,
): void {
  const csv = generateCSV(rows, headers, keys);
  downloadCSV(csv, filename);
}
