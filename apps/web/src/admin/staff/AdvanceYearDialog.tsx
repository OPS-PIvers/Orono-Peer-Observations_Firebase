import { useEffect, useMemo, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { COLLECTIONS, advanceCycle, isStaffYear, type Staff, type StaffYear } from '@ops/shared';
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
import { bulkMergePerRow } from '@/admin/_shared/bulkWrite';
import { cycleStatus, cycleStatusLabel, displayYear } from './staffCycle';

type StaffRow = Staff & { id: string };

interface AdvanceYearDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** All staff rows from the page's one-shot read; the dialog filters to active. */
  staff: StaffRow[];
  /** Apply a local patch to the page's cached rows so the table reflects the
   *  rollover without a refetch (mirrors `useFirestoreCollectionOnce.mutate`). */
  onMutate: (updater: (rows: StaffRow[]) => StaffRow[]) => void;
  /** Called after a successful apply, before the dialog closes. */
  onApplied: () => void;
}

interface ProgressState {
  done: number;
  total: number;
}

/** A row's old→computed-new cycle state, ready for the preview table. */
interface PlanRow {
  email: string;
  name: string;
  fromYear: StaffYear;
  fromSummative: boolean;
  toYear: StaffYear;
  toSummative: boolean;
}

/** "Y2 · Low Cycle" style label for one cycle state. */
function stateLabel(year: number, summativeYear: boolean): string {
  return `Y${String(displayYear(year))} · ${cycleStatusLabel(cycleStatus(year, summativeYear))}`;
}

/**
 * Advance school year wizard — previews the computed next year/status for every
 * active staff member (via the shared `advanceCycle` rule), lets the admin
 * opt rows out, then writes the new `{ year, summativeYear }` in batches with
 * `bulkMergePerRow` (which stamps `updatedAt`). History is client-side only:
 * each touched record's `updatedAt` is the audit trail; a dedicated auditLog
 * entry would need a callable (clients can't write that collection).
 */
export function AdvanceYearDialog({
  open,
  onOpenChange,
  staff,
  onMutate,
  onApplied,
}: AdvanceYearDialogProps) {
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Active staff only — archived members don't advance. Computed once per open.
  const plan = useMemo<PlanRow[]>(() => {
    return staff
      .filter((s) => s.isActive)
      .map((s) => {
        const next = advanceCycle({ year: s.year, summativeYear: s.summativeYear });
        // advanceCycle always returns an in-range year (1-6); narrow `number`
        // back to StaffYear so the write keeps the schema's literal type. The
        // guard is a sound belt-and-suspenders, never expected to fail.
        const toYear: StaffYear = isStaffYear(next.year) ? next.year : 1;
        return {
          email: s.email,
          name: s.name,
          fromYear: s.year,
          fromSummative: s.summativeYear,
          toYear,
          toSummative: next.summativeYear,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [staff]);

  // Reset opt-outs and status each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setExcluded(new Set());
    setProgress(null);
    setError(null);
  }, [open]);

  const included = useMemo(() => plan.filter((p) => !excluded.has(p.email)), [plan, excluded]);
  const submitting = progress !== null && progress.done < progress.total;

  function toggle(email: string) {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email);
      else next.add(email);
      return next;
    });
  }

  function toggleAll() {
    setExcluded((prev) =>
      prev.size === plan.length ? new Set() : new Set(plan.map((p) => p.email)),
    );
  }

  async function apply() {
    setError(null);
    const targets = included;
    if (targets.length === 0) {
      setError('Select at least one staff member to advance.');
      return;
    }
    const byEmail = new Map(targets.map((p) => [p.email, p]));
    const ids = targets.map((p) => p.email);
    setProgress({ done: 0, total: ids.length });
    try {
      await bulkMergePerRow(
        COLLECTIONS.staff,
        ids,
        (id) => {
          const row = byEmail.get(id);
          if (!row) return null;
          return { year: row.toYear, summativeYear: row.toSummative };
        },
        (done, total) => setProgress({ done, total }),
      );
      // Fold the new values into the page's cached rows so the table updates
      // without a refetch (the staff list is a one-shot read).
      onMutate((rows) =>
        rows.map((r) => {
          const row = byEmail.get(r.email);
          return row ? { ...r, year: row.toYear, summativeYear: row.toSummative } : r;
        }),
      );
      onApplied();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Advancing the school year failed.');
      setProgress(null);
    }
  }

  const allExcluded = plan.length > 0 && excluded.size === plan.length;
  const someExcluded = excluded.size > 0 && !allExcluded;

  return (
    <Dialog open={open} onOpenChange={(v) => (submitting ? null : onOpenChange(v))}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Advance school year</DialogTitle>
          <DialogDescription>
            Previews next year&apos;s cycle state for every active staff member. Year 3 is the
            high-cycle (summative) year; probationary P3 graduates to a continuing Year 1. Uncheck
            anyone who should stay put.
          </DialogDescription>
        </DialogHeader>

        {plan.length === 0 ? (
          <div className="text-muted-foreground py-6 text-center text-sm">
            No active staff to advance.
          </div>
        ) : (
          <>
            <div className="max-h-[50vh] overflow-auto rounded-md border">
              <Table>
                <TableHeader className="bg-muted/40 sticky top-0">
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        checked={!allExcluded}
                        indeterminate={someExcluded}
                        onChange={toggleAll}
                        aria-label={allExcluded ? 'Include all staff' : 'Exclude all staff'}
                        disabled={submitting}
                      />
                    </TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Current</TableHead>
                    <TableHead className="w-8" aria-hidden="true" />
                    <TableHead>Next</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {plan.map((p) => {
                    const include = !excluded.has(p.email);
                    return (
                      <TableRow key={p.email} className={include ? undefined : 'opacity-50'}>
                        <TableCell>
                          <Checkbox
                            checked={include}
                            onChange={() => toggle(p.email)}
                            aria-label={`Advance ${p.name}`}
                            disabled={submitting}
                          />
                        </TableCell>
                        <TableCell>
                          <div className="font-medium">{p.name}</div>
                          <div className="text-muted-foreground text-xs">{p.email}</div>
                        </TableCell>
                        <TableCell className="text-muted-foreground whitespace-nowrap">
                          {stateLabel(p.fromYear, p.fromSummative)}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          <ArrowRight className="h-4 w-4" aria-hidden="true" />
                        </TableCell>
                        <TableCell className="font-medium whitespace-nowrap">
                          {stateLabel(p.toYear, p.toSummative)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            <p className="text-muted-foreground text-xs">
              {included.length} of {plan.length} active staff will advance.
            </p>
          </>
        )}

        {progress ? (
          <div className="bg-muted text-muted-foreground rounded-md px-3 py-2 text-sm">
            Updating {progress.done} of {progress.total}…
          </div>
        ) : null}

        {error ? (
          <div className="border-destructive bg-ops-red-lighter text-ops-red-dark rounded-md border-l-4 px-3 py-2 text-sm">
            {error}
          </div>
        ) : null}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            type="button"
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            onClick={() => void apply()}
            disabled={submitting || included.length === 0}
            type="button"
          >
            {submitting ? 'Advancing…' : `Advance ${String(included.length)}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
