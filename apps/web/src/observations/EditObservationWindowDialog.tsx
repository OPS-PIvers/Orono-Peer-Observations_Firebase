import { useEffect, useMemo, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import {
  COLLECTIONS,
  type Building,
  type ObservationWindow,
  type Role,
  type Staff,
  type UpdateObservationWindowInput,
  type WindowInvitee,
} from '@ops/shared';
import { functions } from '@/lib/firebase';
import { useFirestoreCollection } from '@/hooks/useFirestoreCollection';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { yearLabel } from '@/utils/staffFormatting';
import { toDate } from '@/scheduling/slotTime';
import { StaffFilterBar, EMPTY_FILTERS, type StaffFilters } from '@/admin/staff/StaffFilterBar';

interface UpdateObservationWindowResult {
  ok: true;
  endDate: string;
  addedCount: number;
  removedCount: number;
  resentCount: number;
  newSlotCount: number;
}

const updateObservationWindowFn = httpsCallable<
  UpdateObservationWindowInput,
  UpdateObservationWindowResult
>(functions, 'updateObservationWindow');

function inviteStatusLabel(inv: WindowInvitee): string {
  if (inv.bookedSlotId) return 'Booked';
  const sentAt = toDate(inv.inviteSentAt);
  if (sentAt) {
    return `Invited ${sentAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
  }
  return 'Invite not sent';
}

export interface EditObservationWindowDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The window being edited (live doc from the list page). */
  window: (ObservationWindow & { id: string }) | null;
  onSaved: () => void;
}

/**
 * Post-creation window editing: extend the end date, add invitees (they get
 * their own invite token + email), remove un-booked invitees, and resend an
 * individual invite email. Add/remove/extend are staged and applied together
 * on Save; resend fires immediately per invitee.
 */
export function EditObservationWindowDialog({
  open,
  onOpenChange,
  window: win,
  onSaved,
}: EditObservationWindowDialogProps) {
  const { data: staff } = useFirestoreCollection<Staff>(COLLECTIONS.staff);
  const { data: roles } = useFirestoreCollection<Role>(COLLECTIONS.roles);
  const { data: buildings } = useFirestoreCollection<Building>(COLLECTIONS.buildings);

  // Map building display name <-> buildingId slug (staff.buildings holds names).
  const buildingIdByName = useMemo(() => {
    const map = new Map<string, string>();
    for (const b of buildings ?? []) map.set(b.displayName, b.buildingId);
    return map;
  }, [buildings]);
  const buildingNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const b of buildings ?? []) map.set(b.buildingId, b.displayName);
    return map;
  }, [buildings]);

  const [endDate, setEndDate] = useState('');
  /** Emails staged for removal (applied on Save). */
  const [removals, setRemovals] = useState<Set<string>>(new Set());
  /** Staged additions: staff email -> chosen building display name. */
  const [selected, setSelected] = useState<Map<string, string>>(new Map());
  const [filters, setFilters] = useState<StaffFilters>(EMPTY_FILTERS);

  const [resendingEmail, setResendingEmail] = useState<string | null>(null);
  const [resentEmails, setResentEmails] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset staged edits each time the dialog opens for a window.
  useEffect(() => {
    if (!open) return;
    setEndDate(win?.endDate ?? '');
    setRemovals(new Set());
    setSelected(new Map());
    setFilters(EMPTY_FILTERS);
    setResendingEmail(null);
    setResentEmails(new Set());
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seed only on open
  }, [open, win?.id]);

  const invitees = useMemo(() => win?.invitees ?? [], [win]);
  const invitedEmails = useMemo(
    () => new Set(invitees.map((inv) => inv.email.toLowerCase())),
    [invitees],
  );

  // Staff eligible to be added: not currently invited (or staged for removal,
  // which lets a PE fix a wrong building by remove + re-add in one Save).
  const addableStaff = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    return (staff ?? []).filter((s) => {
      const key = s.email.toLowerCase();
      if (invitedEmails.has(key) && !removals.has(key)) return false;
      if (filters.status === 'active' && !s.isActive) return false;
      if (filters.status === 'archived' && s.isActive) return false;
      if (filters.roles.size > 0 && !filters.roles.has(s.role)) return false;
      if (filters.years.size > 0 && !filters.years.has(s.year)) return false;
      if (filters.buildings.size > 0 && !s.buildings.some((b) => filters.buildings.has(b)))
        return false;
      if (q) {
        const matches =
          s.name.toLowerCase().includes(q) ||
          s.email.toLowerCase().includes(q) ||
          s.role.toLowerCase().includes(q) ||
          s.buildings.some((b) => b.toLowerCase().includes(q));
        if (!matches) return false;
      }
      return true;
    });
  }, [staff, filters, invitedEmails, removals]);

  function toggleRemoval(email: string) {
    const key = email.toLowerCase();
    setRemovals((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    // Deselect a staged add that depended on this removal being staged.
    setSelected((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
  }

  function toggleStaff(s: Staff) {
    const key = s.email.toLowerCase();
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.set(key, s.buildings[0] ?? '');
      }
      return next;
    });
  }

  function setInviteeBuilding(email: string, buildingName: string) {
    setSelected((prev) => {
      const next = new Map(prev);
      next.set(email.toLowerCase(), buildingName);
      return next;
    });
  }

  async function resendInvite(email: string) {
    if (!win) return;
    setError(null);
    setResendingEmail(email);
    try {
      await updateObservationWindowFn({
        windowId: win.windowId,
        addInvitees: [],
        removeInviteeEmails: [],
        resendInviteEmails: [email],
      });
      setResentEmails((prev) => new Set(prev).add(email));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resend the invite email.');
    } finally {
      setResendingEmail(null);
    }
  }

  const staffByEmail = useMemo(() => {
    const map = new Map<string, Staff>();
    for (const s of staff ?? []) map.set(s.email.toLowerCase(), s);
    return map;
  }, [staff]);

  const resolvedAdds = useMemo(() => {
    return [...selected.entries()].map(([email, buildingName]) => {
      const s = staffByEmail.get(email);
      const buildingId = buildingName ? (buildingIdByName.get(buildingName) ?? null) : null;
      return { email, staff: s, buildingName, buildingId };
    });
  }, [selected, staffByEmail, buildingIdByName]);

  const unresolved = resolvedAdds.filter((i) => !i.buildingId);

  const endDateChanged = win !== null && endDate !== '' && endDate !== win.endDate;
  const hasStagedChanges = endDateChanged || removals.size > 0 || selected.size > 0;
  const remainingCount = invitees.filter((inv) => !removals.has(inv.email.toLowerCase())).length;
  const canSubmit =
    !submitting &&
    hasStagedChanges &&
    unresolved.length === 0 &&
    remainingCount + selected.size > 0;

  async function submit() {
    if (!win) return;
    setError(null);
    if (endDateChanged && endDate < win.endDate) {
      setError('The end date can only be extended, not shortened.');
      return;
    }

    const addInvitees = resolvedAdds
      .filter((i): i is typeof i & { buildingId: string } => i.buildingId !== null)
      .map((i) => ({ email: i.email, buildingId: i.buildingId }));

    const input: UpdateObservationWindowInput = {
      windowId: win.windowId,
      ...(endDateChanged ? { endDate } : {}),
      addInvitees,
      removeInviteeEmails: [...removals],
      resendInviteEmails: [],
    };

    setSubmitting(true);
    try {
      await updateObservationWindowFn(input);
      onOpenChange(false);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update the observation window.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit observation window</DialogTitle>
          <DialogDescription>
            Extend the end date, add or remove invitees, or resend an invite email. Existing
            bookings are never changed.
          </DialogDescription>
        </DialogHeader>

        {win === null ? null : (
          <div className="grid gap-6 py-2">
            {/* End date */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="edit-window-start">Start date</Label>
                <Input id="edit-window-start" type="date" value={win.startDate} disabled />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-window-end">End date (extend only)</Label>
                <Input
                  id="edit-window-end"
                  type="date"
                  value={endDate}
                  min={win.endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
            </div>

            {/* Current invitees */}
            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <Label>Current invitees</Label>
                <span className="text-muted-foreground text-sm">
                  {invitees.length} invited
                  {removals.size > 0 ? ` · ${String(removals.size)} to remove` : ''}
                </span>
              </div>
              <div className="border-border bg-background max-h-64 overflow-y-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="bg-ops-gray-lightest sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold">Name</th>
                      <th className="px-3 py-2 text-left font-semibold">Building</th>
                      <th className="px-3 py-2 text-left font-semibold">Status</th>
                      <th className="w-52 px-3 py-2 text-left font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invitees.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="text-muted-foreground py-6 text-center">
                          No invitees on this window.
                        </td>
                      </tr>
                    ) : (
                      invitees.map((inv) => {
                        const key = inv.email.toLowerCase();
                        const booked = inv.bookedSlotId != null;
                        const staged = removals.has(key);
                        return (
                          <tr
                            key={`${inv.email}-${inv.buildingId}`}
                            className={`border-border border-t ${staged ? 'opacity-60' : ''}`}
                          >
                            <td className="px-3 py-2">
                              <div className={`font-medium ${staged ? 'line-through' : ''}`}>
                                {inv.name}
                              </div>
                              <div className="text-muted-foreground text-xs">{inv.email}</div>
                            </td>
                            <td className="px-3 py-2">
                              {buildingNameById.get(inv.buildingId) ?? inv.buildingId}
                            </td>
                            <td className="px-3 py-2">
                              {booked ? (
                                <span className="inline-flex items-center rounded bg-green-100 px-1.5 py-0.5 text-[11px] font-semibold text-green-700">
                                  Booked
                                </span>
                              ) : (
                                <span className="text-muted-foreground text-xs">
                                  {inviteStatusLabel(inv)}
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2">
                              {booked ? (
                                <span className="text-muted-foreground text-xs">—</span>
                              ) : (
                                <div className="flex flex-wrap items-center gap-2">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={resendingEmail !== null || staged}
                                    onClick={() => void resendInvite(inv.email)}
                                  >
                                    {resendingEmail === inv.email
                                      ? 'Sending…'
                                      : resentEmails.has(inv.email)
                                        ? 'Sent ✓'
                                        : 'Resend invite'}
                                  </Button>
                                  <Button
                                    variant={staged ? 'outline' : 'destructive'}
                                    size="sm"
                                    onClick={() => toggleRemoval(inv.email)}
                                  >
                                    {staged ? 'Undo' : 'Remove'}
                                  </Button>
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
              <p className="text-muted-foreground text-xs">
                Invitees who already booked can&apos;t be removed here — cancel their booking first.
              </p>
            </div>

            {/* Add invitees */}
            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <Label>Add invitees</Label>
                <span className="text-muted-foreground text-sm">{selected.size} to add</span>
              </div>
              <StaffFilterBar
                filters={filters}
                onChange={setFilters}
                roles={roles}
                buildings={buildings}
              />
              <div className="border-border bg-background max-h-64 overflow-y-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="bg-ops-gray-lightest sticky top-0">
                    <tr>
                      <th className="w-10 px-3 py-2 text-left" />
                      <th className="px-3 py-2 text-left font-semibold">Name</th>
                      <th className="px-3 py-2 text-left font-semibold">Year</th>
                      <th className="px-3 py-2 text-left font-semibold">Building (schedule)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {addableStaff.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="text-muted-foreground py-6 text-center">
                          No staff match those filters.
                        </td>
                      </tr>
                    ) : (
                      addableStaff.map((s) => {
                        const key = s.email.toLowerCase();
                        const isSelected = selected.has(key);
                        const chosenBuilding = selected.get(key) ?? '';
                        const resolvedId = chosenBuilding
                          ? buildingIdByName.get(chosenBuilding)
                          : undefined;
                        return (
                          <tr key={s.id} className="border-border border-t">
                            <td className="px-3 py-2">
                              <Checkbox
                                aria-label={`Select ${s.name}`}
                                checked={isSelected}
                                onChange={() => toggleStaff(s)}
                              />
                            </td>
                            <td className="px-3 py-2">
                              <div className="font-medium">{s.name}</div>
                              <div className="text-muted-foreground text-xs">{s.email}</div>
                            </td>
                            <td className="px-3 py-2">{yearLabel(s.year)}</td>
                            <td className="px-3 py-2">
                              {!isSelected ? (
                                <span className="text-muted-foreground text-xs">
                                  {s.buildings.join(', ') || '—'}
                                </span>
                              ) : s.buildings.length > 1 ? (
                                <select
                                  value={chosenBuilding}
                                  onChange={(e) => setInviteeBuilding(s.email, e.target.value)}
                                  className="border-input bg-background h-9 rounded-md border px-2 text-xs"
                                >
                                  {s.buildings.map((b) => (
                                    <option key={b} value={b}>
                                      {b}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <span className="text-xs">{chosenBuilding || '—'}</span>
                              )}
                              {isSelected && !resolvedId ? (
                                <div className="text-ops-red-dark mt-1 text-xs">
                                  No matching building — booking blocked.
                                </div>
                              ) : null}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
              {unresolved.length > 0 ? (
                <div
                  role="alert"
                  className="border-destructive bg-ops-red-lighter text-ops-red-dark rounded-md border-l-4 px-3 py-2 text-sm"
                >
                  {String(unresolved.length)} invitee(s) have no resolvable building. Fix or
                  deselect them before saving.
                </div>
              ) : null}
            </div>

            {error ? (
              <div
                role="alert"
                aria-live="polite"
                className="border-destructive bg-ops-red-lighter text-ops-red-dark rounded-md border-l-4 px-3 py-2 text-sm"
              >
                {error}
              </div>
            ) : null}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" type="button" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button type="button" disabled={!canSubmit} onClick={() => void submit()}>
            {submitting ? 'Saving…' : 'Save changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
