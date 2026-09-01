import { Fragment, memo, useMemo, type ReactNode } from 'react';
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
import { EmptyState } from '@/components/ui/empty-state';
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
  onRowClick?: ((row: T) => void) | undefined;
  /** Empty-state content rendered when not loading and rows.length === 0. */
  empty?: ReactNode;
  /** Trailing per-row content (e.g. a DropdownMenu kebab). */
  rowActions?: ((row: T) => ReactNode) | undefined;
  selection?: AdminDataViewSelection;
  sort?: AdminDataViewSort | null;
  onSortChange?: (next: AdminDataViewSort | null) => void;
  /** When true, columns with an `editCell` render their inline editor. */
  editing?: boolean;
  /** Skeleton row count. */
  skeletonRows?: number;
  /** Extra className on the desktop wrapper. */
  className?: string;
  /** Accessible name for the table. Without it a screen reader announces an
   *  unnamed table, which is indistinguishable from any other on the page. */
  label?: string;
  /** Human name for a row, used as the selection checkbox's accessible name
   *  ("Select Jane Doe"). Falls back to a generic "Select row". */
  rowLabel?: ((row: T) => string) | undefined;
}

/** "Select Jane Doe" beats "Select row" when a screen reader is reading the
 *  225th checkbox in a list and the row it belongs to is not announced. */
function selectionLabel(isSelected: boolean, name: string | undefined): string {
  const verb = isSelected ? 'Deselect' : 'Select';
  return name ? `${verb} ${name}` : `${verb} row`;
}

/**
 * 24x24 hit area around the 18px checkbox. The checkbox itself stays small
 * enough to sit inside a table cell, and the wrapping <label> gives it the
 * target size WCAG 2.2 (2.5.8) asks for without changing how it looks.
 */
function CheckboxTarget({ children }: { children: ReactNode }) {
  return (
    <label className="inline-flex h-6 w-6 cursor-pointer items-center justify-center">
      {children}
    </label>
  );
}

/**
 * Responsive data list used by every admin page. On `md+` viewports it
 * renders a sortable, selectable table; on smaller viewports it renders
 * stacked cards with the same data + actions. Both branches share the
 * same `columns` definition so a single page-level config drives both.
 */
function AdminDataViewImpl<T>(props: AdminDataViewProps<T>) {
  const isDesktop = useIsDesktop();
  return isDesktop ? <DesktopTable {...props} /> : <MobileCards {...props} />;
}

/**
 * Memo boundary. A few hundred rows of inline pill editors is enough work
 * that re-rendering the list on every unrelated page state change (a
 * keystroke in a search box, a dialog opening) drops frames, and React has
 * no way to know the list didn't change. It only pays off when the caller
 * keeps every prop referentially stable — `columns`, `rowKey`, `rowLabel`,
 * `rowActions`, `onRowClick`, and the `selection` object all need
 * `useMemo`/`useCallback` on the page side, or this compares unequal every
 * render and costs a wasted shallow compare instead.
 *
 * `memo` erases the generic, so the cast restores the original call
 * signature; the runtime value is unchanged.
 */
export const AdminDataView = memo(AdminDataViewImpl) as typeof AdminDataViewImpl;

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
  label,
  rowLabel,
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
    <div
      className={cn(
        // `overflow-clip` (not `overflow-hidden`) keeps the rounded-corner
        // clipping without creating a scroll container, so the sticky header
        // below sticks against the page's <main> scrollport.
        'border-border bg-background overflow-clip rounded-lg border shadow-[var(--shadow-card)]',
        className,
      )}
    >
      <Table containerClassName="overflow-visible" aria-label={label}>
        {/* Sticky header: offset below the sticky page chrome (PageHeader
            publishes `--page-chrome-h`; a plain `top-0` would stick but be
            hidden underneath it) plus any active bulk-action bar
            (`--bulk-bar-h`, published by BulkEditBar while shown). The
            cells need an opaque background while stuck; sticky lives on the
            <th>s rather than <thead> for consistent browser behavior, and the
            row divider is an inset shadow because a collapsed-border <tr>
            border stays behind when its cells stick. */}
        <TableHeader className="[&_th]:bg-background [&_th]:sticky [&_th]:top-[calc(var(--page-chrome-h,0px)_+_var(--bulk-bar-h,0px))] [&_th]:z-10 [&_th]:shadow-[inset_0_-1px_0_0_var(--color-border)]">
          <TableRow>
            {selection ? (
              <TableHead scope="col" className="w-10">
                <CheckboxTarget>
                  <Checkbox
                    checked={allSelected}
                    indeterminate={someSelected}
                    onChange={() => selection.onToggleAll(visibleIds)}
                    aria-label={allSelected ? 'Clear selection' : 'Select all visible'}
                  />
                </CheckboxTarget>
              </TableHead>
            ) : null}
            {columns.map((col) => (
              <TableHead
                key={col.key}
                scope="col"
                // Screen readers announce the sort state from `aria-sort`; the
                // arrow icon is the sighted equivalent.
                aria-sort={
                  sort?.key === col.key
                    ? sort.direction === 'asc'
                      ? 'ascending'
                      : 'descending'
                    : col.sortAccessor && onSortChange
                      ? 'none'
                      : undefined
                }
                className={col.headClassName}
              >
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
              <TableCell colSpan={colSpan} className="p-0">
                {typeof empty === 'string' || empty == null ? (
                  <EmptyState title={empty ?? 'No data.'} />
                ) : (
                  <div className="px-4 py-6 text-center">{empty}</div>
                )}
              </TableCell>
            </TableRow>
          ) : (
            (rows ?? []).map((row) => {
              const id = rowKey(row);
              return (
                <DesktopRow
                  key={id}
                  id={id}
                  row={row}
                  columns={columns}
                  editing={editing}
                  isSelected={selection?.selected.has(id) ?? false}
                  rowLabel={rowLabel}
                  onRowClick={onRowClick}
                  onToggleRow={selection?.onToggleRow}
                  rowActions={rowActions}
                />
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
}

interface DesktopRowProps<T> {
  id: string;
  row: T;
  columns: ColumnDef<T>[];
  editing: boolean;
  isSelected: boolean;
  rowLabel?: ((row: T) => string) | undefined;
  onRowClick?: ((row: T) => void) | undefined;
  /** Presence of this callback is what puts the selection checkbox cell in
   *  the row — the `selection` object itself is deliberately not passed,
   *  because its identity changes on every selection change and would defeat
   *  the memo for every row instead of just the one that toggled. */
  onToggleRow?: ((id: string) => void) | undefined;
  rowActions?: ((row: T) => ReactNode) | undefined;
}

function DesktopRowImpl<T>({
  id,
  row,
  columns,
  editing,
  isSelected,
  rowLabel,
  onRowClick,
  onToggleRow,
  rowActions,
}: DesktopRowProps<T>) {
  return (
    <TableRow
      className={cn(
        // Zebra striping + a softer divider between rows.
        'odd:bg-muted/60 border-b-black/[0.04]',
        onRowClick && 'cursor-pointer',
      )}
      onClick={onRowClick ? () => onRowClick(row) : undefined}
      data-state={isSelected ? 'selected' : undefined}
    >
      {onToggleRow ? (
        <TableCell onClick={(e) => e.stopPropagation()}>
          <CheckboxTarget>
            <Checkbox
              checked={isSelected}
              onChange={() => onToggleRow(id)}
              aria-label={selectionLabel(isSelected, rowLabel?.(row))}
            />
          </CheckboxTarget>
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
}

/** Selecting a row, re-sorting, or narrowing a search must not re-run the
 *  inline editors of every other row: each one mounts several Radix popover
 *  triggers, so a 200-row list is thousands of components. */
const DesktopRow = memo(DesktopRowImpl) as typeof DesktopRowImpl;

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
      aria-label={
        typeof label === 'string'
          ? `Sort by ${label}${direction === null ? '' : direction === 'asc' ? ', currently ascending' : ', currently descending'}`
          : undefined
      }
      className={cn(
        'flex items-center gap-1 rounded-sm text-left font-medium transition-colors',
        'focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden',
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
  rowLabel,
}: AdminDataViewProps<T>) {
  const sortableColumns = columns.filter((c) => c.sortAccessor && onSortChange);

  // Memoized because these arrays are props of the memoized card below;
  // recomputing them per render would give every card a fresh identity.
  const { primaryCol, detailCols, footerCols } = useMemo(() => {
    const primary = columns.find((c) => c.mobile?.primary) ?? columns[0];
    return {
      primaryCol: primary,
      detailCols: columns.filter((c) => c !== primary && !c.mobile?.hide && !c.mobile?.footer),
      footerCols: columns.filter((c) => c.mobile?.footer),
    };
  }, [columns]);

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
        <div className="bg-background border-border rounded-lg border">
          {typeof empty === 'string' || empty == null ? (
            <EmptyState title={empty ?? 'No data.'} />
          ) : (
            <div className="px-4 py-8 text-center">{empty}</div>
          )}
        </div>
      ) : (
        (rows ?? []).map((row) => {
          const id = rowKey(row);
          return (
            <MobileCard
              key={id}
              id={id}
              row={row}
              primaryCol={primaryCol}
              detailCols={detailCols}
              footerCols={footerCols}
              editing={editing}
              isSelected={selection?.selected.has(id) ?? false}
              rowLabel={rowLabel}
              onRowClick={onRowClick}
              onToggleRow={selection?.onToggleRow}
              rowActions={rowActions}
            />
          );
        })
      )}
    </div>
  );
}

interface MobileCardProps<T> {
  id: string;
  row: T;
  primaryCol: ColumnDef<T> | undefined;
  detailCols: ColumnDef<T>[];
  footerCols: ColumnDef<T>[];
  editing: boolean;
  isSelected: boolean;
  rowLabel?: ((row: T) => string) | undefined;
  onRowClick?: ((row: T) => void) | undefined;
  /** See `DesktopRowProps.onToggleRow` — passing the selection object here
   *  would re-render every card whenever any one of them is selected. */
  onToggleRow?: ((id: string) => void) | undefined;
  rowActions?: ((row: T) => ReactNode) | undefined;
}

function MobileCardImpl<T>({
  id,
  row,
  primaryCol,
  detailCols,
  footerCols,
  editing,
  isSelected,
  rowLabel,
  onRowClick,
  onToggleRow,
  rowActions,
}: MobileCardProps<T>) {
  const renderCell = (c: ColumnDef<T>) => (editing && c.editCell ? c.editCell(row) : c.cell(row));
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
      className={cn(
        'bg-background border-border rounded-lg border p-4 transition-colors',
        onRowClick && 'hover:border-ops-blue-light cursor-pointer',
        isSelected && 'border-ops-blue ring-ops-blue/20 ring-2',
      )}
      {...interactiveProps}
    >
      <div className="flex items-start gap-3">
        {onToggleRow ? (
          <CheckboxTarget>
            <Checkbox
              checked={isSelected}
              onChange={() => onToggleRow(id)}
              onClick={(e) => e.stopPropagation()}
              aria-label={selectionLabel(isSelected, rowLabel?.(row))}
            />
          </CheckboxTarget>
        ) : null}
        <div className="min-w-0 flex-1">
          {primaryCol ? (
            <div className="text-base leading-tight font-medium break-words">
              {renderCell(primaryCol)}
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
                    <dd className="min-w-0 break-words">{renderCell(c)}</dd>
                  </Fragment>
                );
              })}
            </dl>
          ) : null}
          {footerCols.length > 0 ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {footerCols.map((c) => (
                <Fragment key={c.key}>{renderCell(c)}</Fragment>
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
}

const MobileCard = memo(MobileCardImpl) as typeof MobileCardImpl;

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
        // The wrapping <label>'s text is a state ("Some selected"), not a
        // control name, so name the control explicitly.
        aria-label={allSelected ? 'Clear selection' : 'Select all visible'}
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
