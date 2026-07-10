import { useMemo, useRef, useState } from 'react';
import { AlertTriangle, FileUp, X } from 'lucide-react';
import { COLLECTIONS, type ModuleDoc, type Role, type Staff } from '@ops/shared';
import { useFirestoreCollection } from '@/hooks/useFirestoreCollection';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  commitStaffCsvRows,
  parseStaffCsv,
  STAFF_CSV_COLUMNS,
  type StaffCsvParseResult,
  type StaffCsvRow,
  type StaffCsvRowAction,
} from './staffCsv';
import { yearLabel } from '@/utils/staffFormatting';

interface StaffImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Full, unfiltered roster — needed to diff against every possible row,
   *  not just the currently filtered/visible table. */
  staff: (Staff & { id: string })[];
  onApplied: () => void;
}

interface ProgressState {
  done: number;
  total: number;
}

const ACTION_LABEL: Record<StaffCsvRowAction, string> = {
  create: 'Create',
  update: 'Update',
  unchanged: 'No change',
  error: 'Error',
};

const ACTION_CLASSNAME: Record<StaffCsvRowAction, string> = {
  create: 'bg-green-100 text-green-800',
  update: 'bg-ops-blue-lighter text-ops-blue-dark',
  unchanged: 'bg-muted text-muted-foreground',
  error: 'bg-ops-red-lighter text-ops-red-dark',
};

export function StaffImportDialog({
  open,
  onOpenChange,
  staff,
  onApplied,
}: StaffImportDialogProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parseResult, setParseResult] = useState<StaffCsvParseResult | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [commitError, setCommitError] = useState<string | null>(null);

  // Resolve against ALL roles/modules (including inactive ones) so an
  // exported roster round-trips: staff can still be assigned to a role or
  // module that was deactivated after the fact, and their rows must not
  // fail import with "Unknown role/module".
  const { data: rolesRaw, loading: rolesLoading } = useFirestoreCollection<Role>(COLLECTIONS.roles);
  const { data: modulesRaw, loading: modulesLoading } = useFirestoreCollection<ModuleDoc>(
    COLLECTIONS.modules,
  );
  const roles = useMemo(() => rolesRaw ?? [], [rolesRaw]);
  const modules = useMemo(() => modulesRaw ?? [], [modulesRaw]);
  const refDataLoading = rolesLoading || modulesLoading;

  const existingByEmail = useMemo(() => {
    const map = new Map<string, Staff>();
    for (const s of staff) map.set(s.email.toLowerCase(), s);
    return map;
  }, [staff]);

  function reset() {
    setFileName(null);
    setParseResult(null);
    setReadError(null);
    setProgress(null);
    setCommitError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function handleFile(file: File) {
    setReadError(null);
    setCommitError(null);
    setFileName(file.name);
    try {
      const text = await file.text();
      const result = parseStaffCsv(text, { roles, modules, existingByEmail });
      setParseResult(result);
    } catch (err) {
      setParseResult(null);
      setReadError(err instanceof Error ? err.message : 'Failed to read the file.');
    }
  }

  const rows = useMemo(() => parseResult?.rows ?? [], [parseResult]);
  const counts = useMemo(() => {
    const c = { create: 0, update: 0, unchanged: 0, error: 0 };
    for (const r of rows) c[r.action] += 1;
    return c;
  }, [rows]);
  const hasErrors = counts.error > 0;
  const commitTotal = counts.create + counts.update;
  const submitting = progress !== null && progress.done < progress.total;

  async function commit() {
    if (!parseResult) return;
    setCommitError(null);
    setProgress({ done: 0, total: commitTotal });
    try {
      await commitStaffCsvRows(parseResult.rows, existingByEmail, (done, total) =>
        setProgress({ done, total }),
      );
      onApplied();
      onOpenChange(false);
    } catch (err) {
      setCommitError(err instanceof Error ? err.message : 'Import failed.');
      setProgress(null);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (submitting) return;
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import staff from CSV</DialogTitle>
          <DialogDescription>
            Upload a CSV to bulk-create or bulk-update the staff roster. Rows are matched to
            existing staff by email; nothing is written until you review the preview and confirm.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFile(file);
              }}
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={refDataLoading || submitting}
            >
              <FileUp />
              {refDataLoading ? 'Loading roles/modules…' : 'Choose CSV file…'}
            </Button>
            {fileName ? (
              <span className="text-muted-foreground flex items-center gap-1 text-sm">
                {fileName}
                <button
                  type="button"
                  onClick={reset}
                  className="hover:text-destructive"
                  aria-label="Clear selected file"
                  disabled={submitting}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            ) : null}
          </div>

          {!fileName ? (
            <p className="text-muted-foreground text-xs">
              Expected columns: {STAFF_CSV_COLUMNS.join(', ')}. Use &ldquo;Export CSV&rdquo; from
              the Staff page to download the current roster as a starting template — role and module
              columns use display names, and buildings/modules can list multiple values separated by
              semicolons.
            </p>
          ) : null}

          {readError ? (
            <div className="border-destructive bg-ops-red-lighter text-ops-red-dark rounded-md border-l-4 px-3 py-2 text-sm">
              {readError}
            </div>
          ) : null}

          {parseResult && parseResult.missingColumns.length > 0 ? (
            <div className="border-destructive bg-ops-red-lighter text-ops-red-dark flex gap-2 rounded-md border-l-4 px-3 py-2 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Missing required column{parseResult.missingColumns.length === 1 ? '' : 's'}:{' '}
                {parseResult.missingColumns.join(', ')}. Fix the header row and re-upload.
              </span>
            </div>
          ) : null}

          {parseResult && parseResult.unknownColumns.length > 0 ? (
            <p className="text-muted-foreground text-xs">
              Ignoring unrecognized column{parseResult.unknownColumns.length === 1 ? '' : 's'}:{' '}
              {parseResult.unknownColumns.join(', ')}.
            </p>
          ) : null}

          {parseResult?.missingColumns.length === 0 && rows.length > 0 ? (
            <>
              <div className="flex flex-wrap gap-3 text-sm">
                <SummaryPill
                  label="Create"
                  count={counts.create}
                  className={ACTION_CLASSNAME.create}
                />
                <SummaryPill
                  label="Update"
                  count={counts.update}
                  className={ACTION_CLASSNAME.update}
                />
                <SummaryPill
                  label="No change"
                  count={counts.unchanged}
                  className={ACTION_CLASSNAME.unchanged}
                />
                <SummaryPill
                  label="Errors"
                  count={counts.error}
                  className={ACTION_CLASSNAME.error}
                />
              </div>

              {hasErrors ? (
                <div className="border-destructive bg-ops-red-lighter text-ops-red-dark rounded-md border-l-4 px-3 py-2 text-sm">
                  Fix {counts.error} row{counts.error === 1 ? '' : 's'} with errors before importing
                  — no changes will be written while any row has an error.
                </div>
              ) : null}

              <div className="border-border max-h-96 overflow-auto rounded-md border">
                <Table>
                  <TableHeader className="bg-muted sticky top-0">
                    <TableRow>
                      <TableHead className="w-12">Row</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Year</TableHead>
                      <TableHead>Buildings</TableHead>
                      <TableHead>Modules</TableHead>
                      <TableHead>Active</TableHead>
                      <TableHead>Admin</TableHead>
                      <TableHead>Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => (
                      <PreviewRow key={row.rowNumber} row={row} />
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          ) : null}

          {parseResult?.missingColumns.length === 0 && rows.length === 0 ? (
            <p className="text-muted-foreground text-sm">No data rows found in this file.</p>
          ) : null}

          {progress ? (
            <div className="bg-muted text-muted-foreground rounded-md px-3 py-2 text-sm">
              Importing {progress.done} of {progress.total}…
            </div>
          ) : null}

          {commitError ? (
            <div className="border-destructive bg-ops-red-lighter text-ops-red-dark rounded-md border-l-4 px-3 py-2 text-sm">
              {commitError}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            onClick={() => void commit()}
            disabled={submitting || !parseResult || hasErrors || commitTotal === 0}
          >
            {submitting
              ? 'Importing…'
              : `Import ${String(commitTotal)} change${commitTotal === 1 ? '' : 's'}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SummaryPill({
  label,
  count,
  className,
}: {
  label: string;
  count: number;
  className: string;
}) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 ${className}`}>
      <span className="font-semibold">{count}</span>
      {label}
    </span>
  );
}

function PreviewRow({ row }: { row: StaffCsvRow }) {
  const input = row.input;
  return (
    <>
      <TableRow className={row.action === 'error' ? 'bg-ops-red-lighter/40' : undefined}>
        <TableCell className="text-muted-foreground">{row.rowNumber}</TableCell>
        <TableCell className="font-medium">{input?.email ?? row.raw.email}</TableCell>
        <TableCell>{input?.name ?? row.raw.name}</TableCell>
        <TableCell>{row.raw.role}</TableCell>
        <TableCell>{input ? yearLabel(input.year) : row.raw.year}</TableCell>
        <TableCell className="max-w-40 truncate" title={row.raw.buildings}>
          {row.raw.buildings}
        </TableCell>
        <TableCell className="max-w-40 truncate" title={row.raw.modules}>
          {row.raw.modules}
        </TableCell>
        <TableCell>{input ? (input.isActive ? 'Yes' : 'No') : row.raw.isActive}</TableCell>
        <TableCell>
          {input ? (input.hasAdminAccess ? 'Yes' : 'No') : row.raw.hasAdminAccess}
        </TableCell>
        <TableCell>
          <span
            className={`inline-block rounded-md px-2 py-0.5 text-xs font-medium ${ACTION_CLASSNAME[row.action]}`}
          >
            {ACTION_LABEL[row.action]}
          </span>
        </TableCell>
      </TableRow>
      {row.errors.length > 0 ? (
        <TableRow className="bg-ops-red-lighter/40 hover:bg-ops-red-lighter/40">
          <TableCell />
          <TableCell colSpan={9} className="text-ops-red-dark py-1.5 text-xs">
            {row.errors.join(' ')}
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}
