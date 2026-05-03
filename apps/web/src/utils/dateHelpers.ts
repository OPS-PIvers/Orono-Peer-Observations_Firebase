export function toDateInputValue(d: Date | undefined): string {
  if (!d) return '';
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${String(year)}-${month}-${day}`;
}

export function parseDateInput(s: string): Date | undefined {
  if (!s) return undefined;
  const d = new Date(s + 'T00:00:00');
  return Number.isNaN(d.getTime()) ? undefined : d;
}
