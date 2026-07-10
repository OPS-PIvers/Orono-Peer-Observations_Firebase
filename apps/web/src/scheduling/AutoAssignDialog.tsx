import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import type { AssignObservationFromPreferenceInput, ObservationWindow } from '@ops/shared';
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
import { functions } from '@/lib/firebase';
import {
  buildAutoAssignPlan,
  type AutoAssignProposal,
  type PreferenceDoc,
  type SlotDoc,
} from './autoAssignPreferences';
import { formatLocalTime, formatYMD } from './slotTime';

interface AssignResult {
  observationId: string;
}

const assignFromPreferenceFn = httpsCallable<AssignObservationFromPreferenceInput, AssignResult>(
  functions,
  'assignObservationFromPreference',
);

type RowStatus = 'pending' | 'assigning' | 'done' | 'error';

interface ExecutionRow extends AutoAssignProposal {
  status: RowStatus;
  error?: string;
}

interface AutoAssignDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  windowId: string;
  preferences: PreferenceDoc[];
  slots: SlotDoc[];
  window: ObservationWindow;
}

function slotLabel(startUTC: unknown, periodName: string): string {
  const time = formatLocalTime(startUTC);
  return periodName ? `${time} · ${periodName}` : time;
}

export function AutoAssignDialog({
  open,
  onOpenChange,
  windowId,
  preferences,
  slots,
  window: obsWindow,
}: AutoAssignDialogProps) {
  // Frozen once execution starts, so an in-flight run isn't reshuffled by
  // live snapshot updates (e.g. another PE booking a slot concurrently).
  const [rows, setRows] = useState<ExecutionRow[] | null>(null);
  const [running, setRunning] = useState(false);

  const plan = useMemo(
    () => buildAutoAssignPlan(preferences, slots, obsWindow),
    [preferences, slots, obsWindow],
  );

  // Reset the frozen run whenever the dialog is (re)opened fresh.
  useEffect(() => {
    if (open) {
      setRows(null);
      setRunning(false);
    }
  }, [open]);

  const displayRows: ExecutionRow[] =
    rows ?? plan.proposals.map((p) => ({ ...p, status: 'pending' as const }));
  const total = displayRows.length;
  const doneCount = displayRows.filter((r) => r.status === 'done').length;
  const errorCount = displayRows.filter((r) => r.status === 'error').length;
  const finished = rows !== null && !running;

  async function runAssignments() {
    if (total === 0) return;
    setRunning(true);
    const working: ExecutionRow[] = plan.proposals.map((p) => ({ ...p, status: 'pending' }));
    setRows(working);

    for (let i = 0; i < working.length; i += 1) {
      const row = working[i];
      if (!row) continue;
      working[i] = { ...row, status: 'assigning' };
      setRows([...working]);
      try {
        await assignFromPreferenceFn({
          windowId,
          email: row.email,
          slotId: row.slotId,
        });
        working[i] = { ...row, status: 'done' };
      } catch (err) {
        working[i] = {
          ...row,
          status: 'error',
          error: err instanceof Error ? err.message : 'Assignment failed.',
        };
      }
      setRows([...working]);
    }
    setRunning(false);
  }

  function close() {
    if (running) return;
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? onOpenChange(true) : close())}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Auto-assign all preferences</DialogTitle>
          <DialogDescription>
            Proposes a conflict-free time for every unassigned day preference at once. Review the
            plan below, then confirm to book them — each row calls the same assignment used for a
            single manual assign, so nothing here bypasses the usual checks.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          {total === 0 ? (
            <p className="text-muted-foreground text-sm">
              Nothing to assign — every submitted preference already has a time, or there are no
              open slots left to propose.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-3 text-sm">
                <SummaryPill
                  label="Proposed"
                  count={total}
                  className="bg-ops-blue-lighter text-ops-blue-dark"
                />
                {rows ? (
                  <>
                    <SummaryPill
                      label="Assigned"
                      count={doneCount}
                      className="bg-green-100 text-green-800"
                    />
                    <SummaryPill
                      label="Failed"
                      count={errorCount}
                      className="bg-ops-red-lighter text-ops-red-dark"
                    />
                  </>
                ) : null}
                {plan.skipped.length > 0 ? (
                  <SummaryPill
                    label="Skipped"
                    count={plan.skipped.length}
                    className="bg-muted text-muted-foreground"
                  />
                ) : null}
              </div>

              <div className="border-border max-h-80 overflow-auto rounded-md border">
                <Table>
                  <TableHeader className="bg-muted sticky top-0">
                    <TableRow>
                      <TableHead>Staff</TableHead>
                      <TableHead>Day</TableHead>
                      <TableHead>Proposed time</TableHead>
                      <TableHead className="w-32">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {displayRows.map((row) => (
                      <TableRow key={row.prefId}>
                        <TableCell>
                          <div className="font-medium">{row.name}</div>
                          <div className="text-muted-foreground text-xs">{row.email}</div>
                        </TableCell>
                        <TableCell className="text-sm">{formatYMD(row.preferredDateYMD)}</TableCell>
                        <TableCell className="text-sm">
                          {slotLabel(row.slotStartUTC, row.periodName)}
                        </TableCell>
                        <TableCell>
                          <RowStatusBadge row={row} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}

          {plan.skipped.length > 0 ? (
            <div className="border-ops-red bg-ops-red-lighter text-ops-red-dark flex gap-2 rounded-md border-l-4 px-3 py-2 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <div className="font-medium">
                  {plan.skipped.length} preference{plan.skipped.length === 1 ? '' : 's'} could not
                  be proposed:
                </div>
                <ul className="mt-1 grid gap-0.5">
                  {plan.skipped.map((s) => (
                    <li key={s.prefId}>
                      {s.name} ({formatYMD(s.preferredDateYMD)}) — {s.reason}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}

          {finished && errorCount > 0 ? (
            <div className="border-destructive bg-ops-red-lighter text-ops-red-dark rounded-md border-l-4 px-3 py-2 text-sm">
              {errorCount} assignment{errorCount === 1 ? '' : 's'} failed — see the row
              {errorCount === 1 ? '' : 's'} above. Assignments that succeeded are already booked;
              close this dialog and re-run auto-assign to retry the rest.
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" type="button" onClick={close} disabled={running}>
            {finished ? 'Close' : 'Cancel'}
          </Button>
          {!finished ? (
            <Button onClick={() => void runAssignments()} disabled={running || total === 0}>
              {running ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Assigning {doneCount + errorCount} of {total}…
                </>
              ) : (
                `Assign ${String(total)} observation${total === 1 ? '' : 's'}`
              )}
            </Button>
          ) : null}
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

function RowStatusBadge({ row }: { row: ExecutionRow }) {
  switch (row.status) {
    case 'pending':
      return <span className="text-muted-foreground text-xs">Pending</span>;
    case 'assigning':
      return (
        <span className="text-ops-blue-dark flex items-center gap-1 text-xs">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Assigning…
        </span>
      );
    case 'done':
      return (
        <span className="flex items-center gap-1 text-xs text-green-800">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Assigned
        </span>
      );
    case 'error':
      return (
        <span className="text-ops-red-dark flex items-center gap-1 text-xs" title={row.error}>
          <XCircle className="h-3.5 w-3.5" />
          Failed
        </span>
      );
  }
}
