import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft, CheckCircle2 } from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import {
  COLLECTIONS,
  WINDOW_SUBCOLLECTIONS,
  type AssignObservationFromPreferenceInput,
  type ObservationPreference,
  type ObservationSlot,
  type ObservationWindow,
} from '@ops/shared';
import { PageHeader } from '@/components/PageHeader';
import { Skeleton } from '@/components/Skeleton';
import { useFirestoreCollection } from '@/hooks/useFirestoreCollection';
import { useFirestoreDoc } from '@/hooks/useFirestoreDoc';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { functions } from '@/lib/firebase';
import { formatLocalDateTime, formatLocalTime, formatYMD } from './slotTime';

interface AssignResult {
  observationId: string;
}

const assignFromPreferenceFn = httpsCallable<AssignObservationFromPreferenceInput, AssignResult>(
  functions,
  'assignObservationFromPreference',
);

type SlotDoc = ObservationSlot & { id: string };
type PrefDoc = ObservationPreference & { id: string };

const SELECT_CLASS = 'border-input bg-background h-10 rounded-md border px-2 text-sm';

export function AssignPreferencesPage() {
  const { windowId } = useParams<{ windowId: string }>();
  const navigate = useNavigate();

  const windowPath = windowId ? `${COLLECTIONS.observationWindows}/${windowId}` : '';
  const { data: windowDoc, loading: windowLoading } =
    useFirestoreDoc<ObservationWindow>(windowPath);

  const slotsPath = windowId
    ? `${COLLECTIONS.observationWindows}/${windowId}/${WINDOW_SUBCOLLECTIONS.slots}`
    : '';
  const { data: slots } = useFirestoreCollection<ObservationSlot>(slotsPath);

  const prefsPath = windowId
    ? `${COLLECTIONS.observationWindows}/${windowId}/${WINDOW_SUBCOLLECTIONS.preferences}`
    : '';
  const { data: preferences, loading: prefsLoading } =
    useFirestoreCollection<ObservationPreference>(prefsPath);

  // Local selection of slot per preference (keyed by email/doc id).
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sortedPrefs = useMemo(() => {
    return (preferences ?? [])
      .slice()
      .sort((a, b) => a.preferredDateYMD.localeCompare(b.preferredDateYMD));
  }, [preferences]);

  function availableSlotsFor(pref: PrefDoc): SlotDoc[] {
    return (slots ?? [])
      .filter(
        (s) =>
          s.buildingId === pref.buildingId &&
          s.dateYMD === pref.preferredDateYMD &&
          s.status === 'available',
      )
      .sort((a, b) => a.startMinute - b.startMinute);
  }

  async function assign(pref: PrefDoc) {
    if (!windowId) return;
    const slotId = selected[pref.id];
    if (!slotId) {
      setError('Pick a slot to assign first.');
      return;
    }
    setError(null);
    setAssigningId(pref.id);
    try {
      await assignFromPreferenceFn({ windowId, email: pref.email, slotId });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not assign that slot.');
    } finally {
      setAssigningId(null);
    }
  }

  const isDayPreference = windowDoc?.bookingMode === 'day-preference';

  return (
    <PageHeader
      title="Assign observation times"
      subtitle={
        windowDoc ? `${windowDoc.startDate} – ${windowDoc.endDate}` : 'Day-preference window'
      }
      actions={
        <Button
          variant="outline"
          size="sm"
          onClick={() => navigate('/observations/windows')}
          className="border-white/40 bg-white/10 text-white hover:bg-white/20 hover:text-white"
        >
          <ChevronLeft className="h-4 w-4" />
          Back
        </Button>
      }
    >
      {error ? (
        <div
          role="alert"
          className="border-destructive bg-ops-red-lighter text-ops-red-dark mb-4 rounded-md border-l-4 px-3 py-2 text-sm"
        >
          {error}
        </div>
      ) : null}

      {windowLoading && !windowDoc ? (
        <Skeleton className="h-40 w-full" />
      ) : !windowDoc ? (
        <p className="text-muted-foreground py-6 text-center text-sm">Window not found.</p>
      ) : !isDayPreference ? (
        <p className="text-muted-foreground py-6 text-center text-sm">
          This window uses direct booking and has no preferences to assign.
        </p>
      ) : (
        <div className="border-border bg-background overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Staff</TableHead>
                <TableHead>Chosen day</TableHead>
                <TableHead>Details</TableHead>
                <TableHead className="w-80">Assign time</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {prefsLoading && !preferences ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={`skeleton-${String(i)}`}>
                    <TableCell>
                      <Skeleton className="h-4 w-32" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-28" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-24" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-9 w-64" />
                    </TableCell>
                  </TableRow>
                ))
              ) : sortedPrefs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-muted-foreground py-6 text-center">
                    No preferences have been submitted yet.
                  </TableCell>
                </TableRow>
              ) : (
                sortedPrefs.map((pref) => {
                  const assigned = pref.assignedSlotId != null;
                  const assignedSlot = assigned
                    ? (slots ?? []).find((s) => s.slotId === pref.assignedSlotId)
                    : undefined;
                  const options = availableSlotsFor(pref);
                  const chosen = selected[pref.id] ?? '';
                  return (
                    <TableRow key={pref.id}>
                      <TableCell>
                        <div className="font-medium">{pref.name || pref.email}</div>
                        <div className="text-muted-foreground text-xs">{pref.email}</div>
                      </TableCell>
                      <TableCell className="text-sm">{formatYMD(pref.preferredDateYMD)}</TableCell>
                      <TableCell className="text-sm">
                        {pref.detailAnswers.length === 0 ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <ul className="grid gap-0.5">
                            {pref.detailAnswers.map((a) => (
                              <li key={a.fieldId} className="text-xs">
                                {a.value}
                              </li>
                            ))}
                          </ul>
                        )}
                      </TableCell>
                      <TableCell>
                        {assigned ? (
                          <div className="text-ops-blue-dark flex items-center gap-2 text-sm">
                            <CheckCircle2 className="h-4 w-4" />
                            {assignedSlot ? formatLocalDateTime(assignedSlot.startUTC) : 'Assigned'}
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <select
                              value={chosen}
                              onChange={(e) =>
                                setSelected((prev) => ({ ...prev, [pref.id]: e.target.value }))
                              }
                              className={SELECT_CLASS}
                              disabled={options.length === 0 || assigningId === pref.id}
                            >
                              <option value="">
                                {options.length === 0 ? 'No open slots' : 'Select a time…'}
                              </option>
                              {options.map((s) => (
                                <option key={s.id} value={s.slotId}>
                                  {formatLocalTime(s.startUTC)}
                                  {s.periodName ? ` · ${s.periodName}` : ''}
                                </option>
                              ))}
                            </select>
                            <Button
                              size="sm"
                              disabled={chosen === '' || assigningId === pref.id}
                              onClick={() => void assign(pref)}
                            >
                              {assigningId === pref.id ? 'Assigning…' : 'Assign'}
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </PageHeader>
  );
}
