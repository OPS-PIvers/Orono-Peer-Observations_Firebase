import { useEffect, useState } from 'react';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import {
  COLLECTIONS,
  OBSERVATION_STATUS,
  OBSERVATION_TYPES,
  type ObservationType,
  type Role,
  type Staff,
} from '@ops/shared';
import { useAuth } from '@/auth/AuthProvider';
import { db } from '@/lib/firebase';
import { useFirestoreCollection } from '@/hooks/useFirestoreCollection';
import { useFirestoreDoc } from '@/hooks/useFirestoreDoc';
import { useNewObservationsDisabled } from '@/hooks/useNewObservationsDisabled';
import { roleDisplayName } from '@/utils/roleLookup';
import { yearLabel } from '@/utils/staffFormatting';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export interface CreateObservationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  staff: Staff;
  onCreated: (observationId: string) => void;
}

export function CreateObservationDialog({
  open,
  onOpenChange,
  staff,
  onCreated,
}: CreateObservationDialogProps) {
  const { user } = useAuth();
  const { data: roles } = useFirestoreCollection<Role>(COLLECTIONS.roles);
  // Own staff doc — used to denormalize the observer's display name onto the
  // observation so the observed staff member's dashboard can show it without
  // read access to the observer's /staff doc.
  const observerEmailLower = user?.email?.toLowerCase() ?? '';
  const { data: observerStaff } = useFirestoreDoc<Staff>(
    observerEmailLower ? `${COLLECTIONS.staff}/${observerEmailLower}` : '',
  );
  // Admin cutover switch: when the "Disable new observation creation" toggle is
  // on, block creation at this shared funnel so both entry points (the staff
  // page button and the New Observation staff picker) are covered.
  const newObservationsDisabled = useNewObservationsDisabled();
  const [type, setType] = useState<ObservationType>(OBSERVATION_TYPES.standard);
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form whenever the dialog opens so stale values don't linger
  // if the same component instance is reused across multiple opens.
  useEffect(() => {
    if (open) {
      setType(OBSERVATION_TYPES.standard);
      setName('');
      setError(null);
    }
  }, [open]);

  async function create() {
    if (newObservationsDisabled) {
      setError('New observation creation is currently disabled by an administrator.');
      return;
    }
    const observerEmail = user?.email;
    if (!observerEmail) {
      setError('Missing observer context.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const ref = await addDoc(collection(db, COLLECTIONS.observations), {
        observerEmail: observerEmail.toLowerCase(),
        observerName: observerStaff?.name ?? '',
        observedEmail: staff.email.toLowerCase(),
        observedName: staff.name,
        observedRole: staff.role,
        observedYear: staff.year,
        observedBuildings: staff.buildings,
        status: OBSERVATION_STATUS.draft,
        type,
        observationName: name.trim(),
        observationData: {},
        componentNotes: {},
        evidenceLinks: {},
        componentTags: [],
        workProductAnswers: [],
        audioDriveFileIds: [],
        transcripts: {},
        driveFolderId: null,
        pdfDriveFileId: null,
        observationDate: new Date(),
        createdAt: serverTimestamp(),
        lastModifiedAt: serverTimestamp(),
        finalizedAt: null,
      });
      onOpenChange(false);
      onCreated(ref.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create observation');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New observation</DialogTitle>
          <DialogDescription>
            Creating an observation for <strong>{staff.name}</strong> (
            {roleDisplayName(roles, staff.role)}, {yearLabel(staff.year)})
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="obs-type">Type</Label>
            <select
              id="obs-type"
              value={type}
              onChange={(e) => setType(e.target.value as ObservationType)}
              className="border-input bg-background h-11 rounded-md border px-3 text-sm"
            >
              <option value={OBSERVATION_TYPES.standard}>Standard observation</option>
              <option value={OBSERVATION_TYPES.workProduct}>Work product</option>
              <option value={OBSERVATION_TYPES.instructionalRound}>Instructional round</option>
            </select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="obs-name">Name (optional)</Label>
            <Input
              id="obs-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Period 3 Algebra (Oct 14)"
            />
            <p className="text-muted-foreground text-xs">
              Helpful when a PE has multiple observations of the same staff member. Leave blank if
              not needed.
            </p>
          </div>

          {newObservationsDisabled ? (
            <div
              role="status"
              aria-live="polite"
              className="border-ops-blue bg-ops-blue-lighter text-ops-blue-dark rounded-md border-l-4 px-3 py-2 text-sm"
            >
              New observation creation is currently disabled by an administrator.
            </div>
          ) : null}

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

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} type="button">
            Cancel
          </Button>
          <Button onClick={() => void create()} disabled={submitting || newObservationsDisabled}>
            {submitting ? 'Creating…' : 'Create observation'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
