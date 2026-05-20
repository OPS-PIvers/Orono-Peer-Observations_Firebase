import { Fragment, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, MoreVertical } from 'lucide-react';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { Skeleton } from '@/components/Skeleton';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

export type SortDirection = 'asc' | 'desc';

export interface ColumnDef<T> {
  /** Stable identifier for this column. Used as the sort key. */
  key: string;
  /** Header label (string is rendered plainly; ReactNode allows icons). */
  header: ReactNode;
  /** className applied to <TableCell> on desktop only. */
  cellClassName?: string;
  /** className applied to <TableHead> on desktop only. */
  headClassName?: string;
  /**
   * Pure value for sorting. Strings sort case-insensitively, numbers
   * numerically. Returning null/undefined sinks the row to the bottom
   * regardless of direction.
   */
  sortAccessor?: (row: T) => string | number | null | undefined;
  cell: (row: T) => ReactNode;
  /** Inline editor rendered in place of `cell` when the view is in edit
   *  mode (`editing` prop). Columns without this keep showing `cell`. */
  editCell?: (row: T) => ReactNode;
  /** Mobile-card placement overrides. */
  mobile?: {
    /** Become the card title. Only one column should set this. */
    primary?: boolean;
    /** Label shown beside the cell value in the card key/value list.
     *  Defaults to the header text if it's a string. */
    label?: string;
    /** Omit from the mobile card. */
    hide?: boolean;
    /** Render full-width below the key/value list (e.g. status row). */
    footer?: boolean;
  };
}

export interface AdminDataViewSelection {
  selected: ReadonlySet<string>;
  onToggleRow: (id: string) => void;
  onToggleAll: (visibleIds: string[]) => void;
}

export interface AdminDataViewSort {
  key: string;
  direction: SortDirection;
}

interface AdminDataViewProps<T> {
  columns: ColumnDef<T>[];
  rows: T[] | null;
  loading: boolean;
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  /** Empty-state content rendered when not loading and rows.length === 0. */
  empty?: ReactNode;
  /** Trailing per-row content (e.g. a DropdownMenu kebab). */
  rowActions?: (row: T) => ReactNode;
  selection?: AdminDataViewSelection;
  sort?: AdminDataViewSort | null;
  onSortChange?: (next: AdminDataViewSort | null) => void;
  /** When true, columns with an `editCell` render their inline editor. */
  editing?: boolean;
  /** Skeleton row count. */
  skeletonRows?: number;
  /** Extra className on the desktop wrapper. */
  className?: string;
}

/**
 * Responsive data list used by every admin page. On `md+` viewports it
 * renders a sortable, selectable table; on smaller viewports it renders
 * stacked cards with the same data + actions. Both branches share the
 * same `columns` definition so a single page-level config drives both.
 */
export function AdminDataView<T>(props: AdminDataViewProps<T>) {
  const isDesktop = useIsDesktop();
  return isDesktop ? <DesktopTable {...props} /> : <MobileCards {...props} />;
}

function DesktopTable<T>({
  columns,
  rows,
  loading,
  rowKey,
  onRowClick,
  empty,
  rowActions,
  selection,
  sort,
  onSortChange,
  editing = false,
  skeletonRows = 6,
  className,
}: AdminDataViewProps<T>) {
  const visibleIds = (rows ?? []).map(rowKey);
  const allSelected = selection
    ? visibleIds.length > 0 && visibleIds.every((id) => selection.selected.has(id))
    : false;
  const someSelected = selection
    ? !allSelected && visibleIds.some((id) => selection.selected.has(id))
    : false;

  const colSpan = columns.length + (selection ? 1 : 0) + (rowActions ? 1 : 0);

  return (
    <div className={cn('border-border bg-background overflow-hidden rounded-lg border', className)}>
      <Table>
        <TableHeader>
          <TableRow>
            {selection ? (
              <TableHead className="w-10">
                <Checkbox
                  checked={allSelected}
                  indeterminate={someSelected}
                  onChange={() => selection.onToggleAll(visibleIds)}
                  aria-label={allSelected ? 'Clear selection' : 'Select all visible'}
                />
              </TableHead>
            ) : null}
            {columns.map((col) => (
              <TableHead key={col.key} className={col.headClassName}>
                {col.sortAccessor && onSortChange ? (
                  <SortableHeader
                    label={col.header}
                    active={sort?.key === col.key}
                    direction={sort?.key === col.key ? sort.direction : null}
                    onClick={() => {
                      if (sort?.key !== col.key) {
                        onSortChange({ key: col.key, direction: 'asc' });
                      } else if (sort.direction === 'asc') {
                        onSortChange({ key: col.key, direction: 'desc' });
                      } else {
                        onSortChange(null);
                      }
                    }}
                  />
                ) : (
                  col.header
                )}
              </TableHead>
            ))}
            {rowActions ? <TableHead className="w-10" /> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading && !rows ? (
            Array.from({ length: skeletonRows }).map((_, i) => (
              <TableRow key={`skeleton-${String(i)}`}>
                {selection ? (
                  <TableCell>
                    <Skeleton className="h-[18px] w-[18px] rounded" />
                  </TableCell>
                ) : null}
                {columns.map((col) => (
                  <TableCell key={col.key} className={col.cellClassName}>
                    <Skeleton className="h-4 w-full max-w-32" />
                  </TableCell>
                ))}
                {rowActions ? (
                  <TableCell>
                    <Skeleton className="h-7 w-7 rounded" />
                  </TableCell>
                ) : null}
              </TableRow>
            ))
          ) : (rows ?? []).length === 0 ? (
            <TableRow>
              <TableCell colSpan={colSpan} className="text-muted-foreground py-6 text-center">
                {empty ?? 'No data.'}
              </TableCell>
            </TableRow>
          ) : (
            (rows ?? []).map((row) => {
              const id = rowKey(row);
              const isSelected = selection?.selected.has(id) ?? false;
              return (
                <TableRow
                  key={id}
                  className={cn(onRowClick && 'cursor-pointer')}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  data-state={isSelected ? 'selected' : undefined}
                >
                  {selection ? (
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={isSelected}
                        onChange={() => selection.onToggleRow(id)}
                        aria-label={isSelected ? 'Deselect row' : 'Select row'}
                      />
                    </TableCell>
                  ) : null}
                  {columns.map((col) => (
                    <TableCell
                      key={col.key}
                      className={col.cellClassName}
                      onClick={editing && col.editCell ? (e) => e.stopPropagation() : undefined}
                    >
                      {editing && col.editCell ? col.editCell(row) : col.cell(row)}
                    </TableCell>
                  ))}
                  {rowActions ? (
                    <TableCell onClick={(e) => e.stopPropagation()}>{rowActions(row)}</TableCell>
                  ) : null}
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function SortableHeader({
  label,
  active,
  direction,
  onClick,
}: {
  label: ReactNode;
  active: boolean;
  direction: SortDirection | null;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-1 text-left font-medium transition-colors',
        'hover:text-foreground',
        active && 'text-foreground',
      )}
    >
      {label}
      {!active ? (
        <ArrowUpDown className="h-3.5 w-3.5 opacity-50" />
      ) : direction === 'asc' ? (
        <ArrowUp className="h-3.5 w-3.5" />
      ) : (
        <ArrowDown className="h-3.5 w-3.5" />
      )}
    </button>
  );
}

function MobileCards<T>({
  columns,
  rows,
  loading,
  rowKey,
  onRowClick,
  empty,
  rowActions,
  selection,
  sort,
  onSortChange,
  editing = false,
  skeletonRows = 5,
  className,
}: AdminDataViewProps<T>) {
  const renderCell = (c: ColumnDef<T>, row: T) =>
    editing && c.editCell ? c.editCell(row) : c.cell(row);
  const sortableColumns = columns.filter((c) => c.sortAccessor && onSortChange);

  const primaryCol = columns.find((c) => c.mobile?.primary) ?? columns[0];
  const detailCols = columns.filter(
    (c) => c !== primaryCol && !c.mobile?.hide && !c.mobile?.footer,
  );
  const footerCols = columns.filter((c) => c.mobile?.footer);

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {/* Mobile sort control — only rendered if at least one column is sortable */}
      {sortableColumns.length > 0 && onSortChange ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Sort by:</span>
          <select
            value={sort ? `${sort.key}:${sort.direction}` : ''}
            onChange={(e) => {
              const v = e.target.value;
              if (!v) {
                onSortChange(null);
                return;
              }
              const [key, dir] = v.split(':');
              if (key && (dir === 'asc' || dir === 'desc')) {
                onSortChange({ key, direction: dir });
              }
            }}
            className="bg-background border-input h-9 min-h-9 rounded-md border px-2 text-sm"
          >
            <option value="">Default</option>
            {sortableColumns.map((c) => (
              <Fragment key={c.key}>
                <option value={`${c.key}:asc`}>
                  {typeof c.header === 'string' ? c.header : c.key} (A–Z)
                </option>
                <option value={`${c.key}:desc`}>
                  {typeof c.header === 'string' ? c.header : c.key} (Z–A)
                </option>
              </Fragment>
            ))}
          </select>
        </div>
      ) : null}

      {selection ? (
        <SelectAllStrip selection={selection} visibleIds={(rows ?? []).map(rowKey)} />
      ) : null}

      {loading && !rows ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: skeletonRows }).map((_, i) => (
            <div
              key={`mskel-${String(i)}`}
              className="bg-background border-border rounded-lg border p-4"
            >
              <Skeleton className="mb-3 h-5 w-40" />
              <div className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            </div>
          ))}
        </div>
      ) : (rows ?? []).length === 0 ? (
        <div className="bg-background border-border text-muted-foreground rounded-lg border px-4 py-8 text-center">
          {empty ?? 'No data.'}
        </div>
      ) : (
        (rows ?? []).map((row) => {
          const id = rowKey(row);
          const isSelected = selection?.selected.has(id) ?? false;
          const interactiveProps = onRowClick
            ? {
                role: 'button' as const,
                tabIndex: 0,
                onClick: () => onRowClick(row),
                onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onRowClick(row);
                  }
                },
              }
            : {};
          return (
            <article
              key={id}
              className={cn(
                'bg-background border-border rounded-lg border p-4 transition-colors',
                onRowClick && 'hover:border-ops-blue-light cursor-pointer',
                isSelected && 'border-ops-blue ring-ops-blue/20 ring-2',
              )}
              {...interactiveProps}
            >
              <div className="flex items-start gap-3">
                {selection ? (
                  <Checkbox
                    checked={isSelected}
                    onChange={() => selection.onToggleRow(id)}
                    onClick={(e) => e.stopPropagation()}
                    aria-label={isSelected ? 'Deselect row' : 'Select row'}
                    className="mt-0.5"
                  />
                ) : null}
                <div className="min-w-0 flex-1">
                  {primaryCol ? (
                    <div className="text-base leading-tight font-medium break-words">
                      {renderCell(primaryCol, row)}
                    </div>
                  ) : null}
                  {detailCols.length > 0 ? (
                    <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
                      {detailCols.map((c) => {
                        const labelText =
                          c.mobile?.label ?? (typeof c.header === 'string' ? c.header : c.key);
                        return (
                          <Fragment key={c.key}>
                            <dt className="text-muted-foreground">{labelText}</dt>
                            <dd className="min-w-0 break-words">{renderCell(c, row)}</dd>
                          </Fragment>
                        );
                      })}
                    </dl>
                  ) : null}
                  {footerCols.length > 0 ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {footerCols.map((c) => (
                        <Fragment key={c.key}>{renderCell(c, row)}</Fragment>
                      ))}
                    </div>
                  ) : null}
                </div>
                {rowActions ? (
                  // The row-actions slot renders interactive children
                  // (a kebab button); the wrapper just stops the click
                  // from bubbling to the card's row-click handler.
                  <div
                    role="presentation"
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                    className="-mr-1"
                  >
                    {rowActions(row)}
                  </div>
                ) : null}
              </div>
            </article>
          );
        })
      )}
    </div>
  );
}

function SelectAllStrip({
  selection,
  visibleIds,
}: {
  selection: AdminDataViewSelection;
  visibleIds: string[];
}) {
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selection.selected.has(id));
  const someSelected = !allSelected && visibleIds.some((id) => selection.selected.has(id));
  return (
    <label className="bg-muted/50 border-border inline-flex w-fit items-center gap-2 rounded-md border px-3 py-1.5 text-sm">
      <Checkbox
        checked={allSelected}
        indeterminate={someSelected}
        onChange={() => selection.onToggleAll(visibleIds)}
      />
      <span className="text-muted-foreground">
        {allSelected
          ? 'Selected all visible'
          : someSelected
            ? 'Some selected'
            : 'Select all visible'}
      </span>
    </label>
  );
}

export { MoreVertical as RowActionIcon };
