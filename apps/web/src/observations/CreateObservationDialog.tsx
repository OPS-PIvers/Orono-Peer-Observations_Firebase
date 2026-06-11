import { useEffect, useState } from 'react';
import {
  collection,
  doc,
  getCountFromServer,
  getDoc,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
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
  const [type, setType] = useState<ObservationType>(OBSERVATION_TYPES.standard);
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * Counts existing active drafts of the chosen type for this staff member.
   * null = not yet loaded; 0 = no duplicates; >0 = show a warning.
   * Only relevant for WP / IR types — standard observations are always 1:1.
   */
  const [existingDraftCount, setExistingDraftCount] = useState<number | null>(null);

  // Reset form whenever the dialog opens so stale values don't linger
  // if the same component instance is reused across multiple opens.
  useEffect(() => {
    if (open) {
      setType(OBSERVATION_TYPES.standard);
      setName('');
      setError(null);
      setExistingDraftCount(null);
    }
  }, [open]);

  // When the selected type changes to WP or IR, query the count of existing
  // draft observations of that type for this staff member so we can warn.
  const observedEmailLower = staff.email.toLowerCase();
  useEffect(() => {
    if (type !== OBSERVATION_TYPES.workProduct && type !== OBSERVATION_TYPES.instructionalRound) {
      setExistingDraftCount(null);
      return;
    }
    let cancelled = false;
    const q = query(
      collection(db, COLLECTIONS.observations),
      where('observedEmail', '==', observedEmailLower),
      where('type', '==', type),
      where('status', '==', OBSERVATION_STATUS.draft),
    );
    void getCountFromServer(q).then((snap) => {
      if (!cancelled) setExistingDraftCount(snap.data().count);
    });
    return () => {
      cancelled = true;
    };
  }, [type, open, observedEmailLower]);

  async function create() {
    const observerEmail = user?.email;
    if (!observerEmail) {
      setError('Missing observer context.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      // Fetch the observer's own staff doc to denormalize their display name.
      // The observer is the currently signed-in user, so their own doc is
      // always readable under the /staff rules. Fall back to '' on any error
      // (e.g. doc doesn't exist yet) — consumers show the email localpart.
      const observerEmailLower = observerEmail.toLowerCase();
      let observerName = '';
      try {
        const observerSnap = await getDoc(doc(db, COLLECTIONS.staff, observerEmailLower));
        if (observerSnap.exists()) {
          observerName = (observerSnap.data() as Staff).name;
        }
      } catch {
        // Non-fatal: proceed with empty name
      }

      // Pre-allocate the doc ref so the denormalized observationId (required
      // by the schema; the booking path stamps it server-side) can be written
      // in the same create. Dashboard CTAs and Acknowledge route by it.
      const ref = doc(collection(db, COLLECTIONS.observations));
      await setDoc(ref, {
        observationId: ref.id,
        observerEmail: observerEmailLower,
        observerName,
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

          {existingDraftCount !== null && existingDraftCount > 0 ? (
            <div
              role="status"
              aria-live="polite"
              className="rounded-md border-l-4 border-amber-600 bg-amber-50 px-3 py-2 text-sm text-amber-900"
            >
              {staff.name} already has {existingDraftCount} active draft{' '}
              {existingDraftCount === 1 ? 'observation' : 'observations'} of this type. Adding
              another will create a second form for them to fill out. Consider naming this one to
              help tell them apart.
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
          <Button onClick={() => void create()} disabled={submitting}>
            {submitting ? 'Creating…' : 'Create observation'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
