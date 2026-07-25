/**
 * Browser-only file download helpers. Deliberately dependency-free and not
 * tied to any one feature — the staff-roster CSV export, the audit-log CSV
 * export, and the dashboard's "Add to calendar" `.ics` download all trigger
 * a download of in-memory text via this same primitive.
 */

/** Trigger a browser download of `text` as a file. Browser-only — not
 *  meaningful in a test/node environment. */
export function downloadTextFile(text: string, filename: string, mimeType: string): void {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}
