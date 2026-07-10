import { useEffect, useMemo, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { ArrowRight } from 'lucide-react';
import {
  isStaffYear,
  isTenureTransition,
  rolloverCycle,
  type ApplyStaffRolloverInput,
  type ApplyStaffRolloverResult,
  type Staff,
  type StaffYear,
} from '@ops/shared';
import { functions } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
import { yearStatusLabel } from '@/utils/staffFormatting';

const applyStaffRolloverFn = httpsCallable<ApplyStaffRolloverInput, ApplyStaffRolloverResult>(
  functions,
  'applyStaffRollover',
);

interface RolloverDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Full, unfiltered roster — the rollover always previews every active
   *  staff member, not just the currently filtered/visible table. */
  staff: (Staff & { id: string })[];
  onApplied: () => void;
}

/** One previewed change. `toSummative` and `included` are admin-editable
 *  before anything is written. */
interface RolloverRow {
  email: string;
  name: string;
  fromYear: StaffYear;
  fromSummative: boolean;
  toYear: StaffYear;
  toSummative: boolean;
  included: boolean;
  gainsTenure: boolean;
}

function buildRows(staff: (Staff & { id: string })[]): {
  rows: RolloverRow[];
  invalidYearCount: number;
} {
  const rows: RolloverRow[] = [];
  let invalidYearCount = 0;
  for (const s of staff) {
    if (!s.isActive) continue;
    // Firestore reads bypass Zod, so guard against legacy/bad year values
    // rather than computing a bogus next position.
    if (!isStaffYear(s.year)) {
      invalidYearCount += 1;
      continue;
    }
    const next = rolloverCycle(s.year);
    rows.push({
      email: s.email,
      name: s.name,
      fromYear: s.year,
      fromSummative: s.summativeYear,
      toYear: next.year,
      toSummative: next.summativeYear,
      included: true,
      gainsTenure: isTenureTransition(s.year),
    });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return { rows, invalidYearCount };
}

/**
 * Annual rollover — advance every active staff member one cycle year
 * (1→2→3→1 continuing; P1→P2→P3→tenure), with the summative flag derived
 * for the new position. Shows a full current→next preview with per-row
 * opt-out and a per-row summative override, then applies via the
 * applyStaffRollover callable (batched writes + audit log, server-side).
 */
export function RolloverDialog({ open, onOpenChange, staff, onApplied }: RolloverDialogProps) {
  const [rows, setRows] = useState<RolloverRow[]>([]);
  const [invalidYearCount, setInvalidYearCount] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ApplyStaffRolloverResult | null>(null);

  // Recompute the preview each time the dialog opens so it always reflects
  // the live roster.
  useEffect(() => {
    if (!open) return;
    const built = buildRows(staff);
    setRows(built.rows);
    setInvalidYearCount(built.invalidYearCount);
    setSubmitting(false);
    setError(null);
    setResult(null);
    // Intentionally NOT keyed on `staff`: re-running mid-review would clobber
    // the admin's per-row opt-outs when the live snapshot ticks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const includedCount = useMemo(() => rows.filter((r) => r.included).length, [rows]);
  const tenureCount = useMemo(() => rows.filter((r) => r.included && r.gainsTenure).length, [rows]);
  const summativeCount = useMemo(
    () => rows.filter((r) => r.included && r.toSummative).length,
    [rows],
  );
  const allIncluded = rows.length > 0 && includedCount === rows.length;
  const someIncluded = includedCount > 0 && !allIncluded;

  function setIncluded(email: string, included: boolean) {
    setRows((prev) => prev.map((r) => (r.email === email ? { ...r, included } : r)));
  }

  function setToSummative(email: string, toSummative: boolean) {
    setRows((prev) => prev.map((r) => (r.email === email ? { ...r, toSummative } : r)));
  }

  function toggleAll() {
    setRows((prev) => prev.map((r) => ({ ...r, included: !allIncluded })));
  }

  async function apply() {
    const entries = rows
      .filter((r) => r.included)
      .map((r) => ({
        email: r.email,
        fromYear: r.fromYear,
        toYear: r.toYear,
        toSummativeYear: r.toSummative,
      }));
    if (entries.length === 0) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await applyStaffRolloverFn({ entries });
      setResult(res.data);
      onApplied();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rollover failed.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (submitting) return;
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Annual rollover</DialogTitle>
          <DialogDescription>
            Advance every active staff member one cycle year for the new school year: tenured staff
            loop 1 → 2 → 3 → 1 (year 3 defaults to summative), probationary staff advance P1 → P2 →
            P3 and then earn tenure at continuing year 1. Review the preview — uncheck anyone who
            should not advance and adjust the summative flag per person — then apply. Nothing is
            written until you confirm.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          {result ? (
            <div className="rounded-md border-l-4 border-green-600 bg-green-50 px-3 py-2 text-sm text-green-900">
              <p className="font-medium">
                Rollover applied to {result.applied} staff member{result.applied === 1 ? '' : 's'}.
              </p>
              {result.skippedStale.length > 0 ? (
                <p className="mt-1">
                  Skipped {result.skippedStale.length} (edited by someone else since this preview
                  loaded — re-run the rollover to pick them up): {result.skippedStale.join(', ')}
                </p>
              ) : null}
              {result.missing.length > 0 ? (
                <p className="mt-1">
                  Skipped {result.missing.length} (no longer in the roster):{' '}
                  {result.missing.join(', ')}
                </p>
              ) : null}
            </div>
          ) : (
            <>
              <div className="flex flex-wrap gap-3 text-sm">
                <SummaryPill
                  label="Advancing"
                  count={includedCount}
                  className="bg-ops-blue-lighter text-ops-blue-dark"
                />
                <SummaryPill
                  label="Gaining tenure"
                  count={tenureCount}
                  className="bg-green-100 text-green-800"
                />
                <SummaryPill
                  label="Summative next year"
                  count={summativeCount}
                  className="bg-amber-100 text-amber-800"
                />
                <SummaryPill
                  label="Opted out"
                  count={rows.length - includedCount}
                  className="bg-muted text-muted-foreground"
                />
              </div>

              {invalidYearCount > 0 ? (
                <div className="border-destructive bg-ops-red-lighter text-ops-red-dark rounded-md border-l-4 px-3 py-2 text-sm">
                  {invalidYearCount} active staff member{invalidYearCount === 1 ? ' has' : 's have'}{' '}
                  an unrecognized cycle year and {invalidYearCount === 1 ? 'is' : 'are'} not
                  included — fix {invalidYearCount === 1 ? 'that record' : 'those records'} in the
                  staff table first.
                </div>
              ) : null}

              {rows.length === 0 ? (
                <p className="text-muted-foreground text-sm">No active staff to roll over.</p>
              ) : (
                <div className="border-border max-h-96 overflow-auto rounded-md border">
                  <Table>
                    <TableHeader className="bg-muted sticky top-0">
                      <TableRow>
                        <TableHead className="w-12">
                          <Checkbox
                            checked={allIncluded}
                            indeterminate={someIncluded}
                            onChange={toggleAll}
                            aria-label="Include all staff in the rollover"
                            disabled={submitting}
                          />
                        </TableHead>
                        <TableHead>Name</TableHead>
                        <TableHead>Current</TableHead>
                        <TableHead className="w-8" aria-hidden />
                        <TableHead>Next year</TableHead>
                        <TableHead className="w-28">Summative</TableHead>
                        <TableHead>Note</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((row) => (
                        <TableRow
                          key={row.email}
                          className={row.included ? undefined : 'text-muted-foreground opacity-60'}
                        >
                          <TableCell>
                            <Checkbox
                              checked={row.included}
                              onChange={(e) => setIncluded(row.email, e.target.checked)}
                              aria-label={`Include ${row.name} in the rollover`}
                              disabled={submitting}
                            />
                          </TableCell>
                          <TableCell>
                            <div className="font-medium">{row.name}</div>
                            <div className="text-muted-foreground text-xs">{row.email}</div>
                          </TableCell>
                          <TableCell>{yearStatusLabel(row.fromYear, row.fromSummative)}</TableCell>
                          <TableCell>
                            <ArrowRight className="text-muted-foreground h-4 w-4" />
                          </TableCell>
                          <TableCell>{yearStatusLabel(row.toYear, row.toSummative)}</TableCell>
                          <TableCell>
                            <Checkbox
                              checked={row.toSummative}
                              onChange={(e) => setToSummative(row.email, e.target.checked)}
                              aria-label={`Summative next year for ${row.name}`}
                              disabled={submitting || !row.included}
                            />
                          </TableCell>
                          <TableCell className="text-xs">
                            {row.gainsTenure ? (
                              <span className="inline-block rounded-md bg-green-100 px-2 py-0.5 font-medium text-green-800">
                                Gains tenure
                              </span>
                            ) : row.fromYear === 3 ? (
                              <span className="text-muted-foreground">Cycle restarts</span>
                            ) : null}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </>
          )}

          {error ? (
            <div className="border-destructive bg-ops-red-lighter text-ops-red-dark rounded-md border-l-4 px-3 py-2 text-sm">
              {error}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          {result ? (
            <Button type="button" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                type="button"
                onClick={() => onOpenChange(false)}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button onClick={() => void apply()} disabled={submitting || includedCount === 0}>
                {submitting
                  ? 'Applying…'
                  : `Apply rollover to ${String(includedCount)} staff member${
                      includedCount === 1 ? '' : 's'
                    }`}
              </Button>
            </>
          )}
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
