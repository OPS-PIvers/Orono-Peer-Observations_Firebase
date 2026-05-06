import type { ColumnDef, SortDirection } from './AdminDataView';

/**
 * Stable sort by a column's `sortAccessor`. Strings compare
 * case-insensitively; numbers compare numerically. Nullish values
 * always sink to the bottom regardless of direction so empty rows
 * don't crowd the top of an alphabetical list.
 */
export function sortRows<T>(
  rows: T[],
  columns: ColumnDef<T>[],
  sort: { key: string; direction: SortDirection } | null,
): T[] {
  if (!sort) return rows;
  const col = columns.find((c) => c.key === sort.key);
  if (!col?.sortAccessor) return rows;
  const accessor = col.sortAccessor;
  const dir = sort.direction === 'asc' ? 1 : -1;

  // Decorate-sort-undecorate to keep the comparator pure and stable.
  return rows
    .map((row, idx) => ({ row, idx, val: accessor(row) }))
    .sort((a, b) => {
      const av = a.val;
      const bv = b.val;
      const aNull = av === null || av === undefined;
      const bNull = bv === null || bv === undefined;
      if (aNull && bNull) return a.idx - b.idx;
      if (aNull) return 1;
      if (bNull) return -1;
      if (typeof av === 'number' && typeof bv === 'number') {
        if (av === bv) return a.idx - b.idx;
        return (av - bv) * dir;
      }
      const as = String(av).toLowerCase();
      const bs = String(bv).toLowerCase();
      if (as === bs) return a.idx - b.idx;
      return as < bs ? -dir : dir;
    })
    .map((d) => d.row);
}
