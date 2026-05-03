export function yearLabel(year: number): string {
  return year < 4 ? `Y${String(year)}` : `P${String(year - 3)}`;
}

export function yearBadgeClass(year: number): string {
  return year < 4
    ? 'bg-gray-100 text-gray-700 border border-gray-200'
    : 'bg-ops-red-lighter text-ops-red-dark border border-ops-red-lighter';
}
