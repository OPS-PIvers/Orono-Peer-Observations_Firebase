export function yearLabel(year: number): string {
  return year < 4 ? `Y${String(year)}` : `P${String(year - 3)}`;
}

export function yearBadgeClass(year: number): string {
  return year < 4
    ? 'bg-gray-100 text-gray-700 border border-gray-200'
    : 'bg-ops-red-lighter text-ops-red-dark border border-ops-red-lighter';
}

/**
 * Human-readable status combining year + summative flag. Example outputs:
 *   "Tenured Year 2 — Summative"
 *   "Tenured Year 3"
 *   "Probationary 1"
 */
export function yearStatusLabel(year: number, summativeYear: boolean): string {
  const base = year < 4 ? `Tenured Year ${String(year)}` : `Probationary ${String(year - 3)}`;
  return summativeYear ? `${base} — Summative` : base;
}

/**
 * School-year bucket for an observation date. Boundary is July 1 (the
 * legal annual changeover for Minnesota public schools), so an obs on
 * 2025-10-15 lands in "2025–2026"; one on 2025-06-30 lands in "2024–2025".
 */
export function schoolYearOf(date: Date): string {
  const year = date.getFullYear();
  const isSecondHalf = date.getMonth() >= 6; // 0=Jan, 6=Jul
  const start = isSecondHalf ? year : year - 1;
  return `${String(start)}–${String(start + 1)}`;
}
