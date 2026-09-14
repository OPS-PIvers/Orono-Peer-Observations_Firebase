import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import {
  COLLECTIONS,
  OBSERVATION_SUBCOLLECTIONS,
  STAFF_SUBCOLLECTIONS,
  toDate,
  type StepCheck,
} from '@ops/shared';
import { db } from '@/lib/firebase';
import type { StepCheckRecord, StepChecksIndex } from './dashboardEvents';

function toRecords(docs: { id: string; data: () => unknown }[]): Record<string, StepCheckRecord> {
  const out: Record<string, StepCheckRecord> = {};
  for (const d of docs) {
    const raw = d.data() as Partial<StepCheck>;
    out[d.id] = {
      stepId: raw.stepId ?? d.id,
      checkedBy: raw.checkedBy ?? '',
      checkedByName: raw.checkedByName ?? '',
      checkedAt: toDate(raw.checkedAt),
    };
  }
  return out;
}

/**
 * Live evaluator check-offs for one staff member: the staff-scoped
 * `staff/{email}/stepChecks` plus `observations/{id}/stepChecks` for each
 * observation the dashboard steps can resolve to. The observation list is
 * dynamic (drafts come and go), so this manages one listener per path
 * rather than a fixed number of `useFirestoreCollection` calls.
 *
 * A listener error (e.g. rules not yet deployed) is treated as "no checks"
 * for that path so the dashboard still renders its automatic state.
 */
export function useStepChecks(staffEmail: string, observationIds: string[]): StepChecksIndex {
  const idsKey = useMemo(
    () => [...new Set(observationIds.filter(Boolean))].sort().join('|'),
    [observationIds],
  );
  const [staffChecks, setStaffChecks] = useState<Record<string, StepCheckRecord>>({});
  const [obsChecks, setObsChecks] = useState<Record<string, Record<string, StepCheckRecord>>>({});

  useEffect(() => {
    setStaffChecks({});
    if (!staffEmail) return;
    return onSnapshot(
      collection(db, COLLECTIONS.staff, staffEmail, STAFF_SUBCOLLECTIONS.stepChecks),
      (snap) => setStaffChecks(toRecords(snap.docs)),
      (err) => {
        console.warn('useStepChecks: staff checks unavailable', err);
        setStaffChecks({});
      },
    );
  }, [staffEmail]);

  useEffect(() => {
    const ids = idsKey ? idsKey.split('|') : [];
    setObsChecks({});
    const unsubs = ids.map((id) =>
      onSnapshot(
        collection(db, COLLECTIONS.observations, id, OBSERVATION_SUBCOLLECTIONS.stepChecks),
        (snap) => setObsChecks((prev) => ({ ...prev, [id]: toRecords(snap.docs) })),
        (err) => {
          console.warn('useStepChecks: observation checks unavailable', { id, err });
          setObsChecks((prev) => ({ ...prev, [id]: {} }));
        },
      ),
    );
    return () => {
      for (const unsub of unsubs) unsub();
    };
  }, [idsKey]);

  return useMemo(
    () => ({ byObservation: obsChecks, staff: staffChecks }),
    [obsChecks, staffChecks],
  );
}
