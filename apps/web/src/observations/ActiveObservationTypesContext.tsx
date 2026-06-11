import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { Observation } from '@ops/shared';
import { useActiveStandardObservation } from '@/hooks/useActiveStandardObservation';
import { useActiveWorkProductObservation } from '@/hooks/useActiveWorkProductObservation';
import { useActiveInstructionalRoundObservation } from '@/hooks/useActiveInstructionalRoundObservation';

type ActiveObservation = (Observation & { id: string }) | null;

interface ActiveObservationTypes {
  /** Most recent Draft observation of each type where the user is observed. */
  standard: ActiveObservation;
  /** All active Draft WP observations (up to 5). First item = workProduct. */
  workProducts: (Observation & { id: string })[];
  /** All active Draft IR observations (up to 5). First item = instructionalRound. */
  instructionalRounds: (Observation & { id: string })[];
  /** Most recent Draft WP observation (convenience — same as workProducts[0] ?? null). */
  workProduct: ActiveObservation;
  /** Most recent Draft IR observation (convenience — same as instructionalRounds[0] ?? null). */
  instructionalRound: ActiveObservation;
  hasWorkProduct: boolean;
  hasInstructionalRound: boolean;
}

export const ActiveObservationTypesContext = createContext<ActiveObservationTypes>({
  standard: null,
  workProducts: [],
  instructionalRounds: [],
  workProduct: null,
  instructionalRound: null,
  hasWorkProduct: false,
  hasInstructionalRound: false,
});

/**
 * Opens the three active-observation listeners once and shares both the raw
 * observation objects and the boolean presence flags with everything below.
 * Consumers (the staff dashboard, MyRubricPage, the sidebar) read from here
 * instead of each calling the active-observation hooks directly, which used
 * to open ~4 duplicate snapshot listeners where 2 suffice.
 *
 * workProducts / instructionalRounds expose the full list so MyRubricPage can
 * render one answer form per active observation (not just the most recent one).
 */
export function ActiveObservationTypesProvider({
  email,
  children,
}: {
  email: string;
  children: ReactNode;
}) {
  const { observation: standard } = useActiveStandardObservation(email);
  const { observations: wps } = useActiveWorkProductObservation(email);
  const { observations: irs } = useActiveInstructionalRoundObservation(email);
  const value = useMemo<ActiveObservationTypes>(
    () => ({
      standard: standard ?? null,
      workProducts: wps,
      instructionalRounds: irs,
      workProduct: wps[0] ?? null,
      instructionalRound: irs[0] ?? null,
      hasWorkProduct: wps.length > 0,
      hasInstructionalRound: irs.length > 0,
    }),
    [standard, wps, irs],
  );
  return <ActiveObservationTypesContext value={value}>{children}</ActiveObservationTypesContext>;
}

export function useActiveObservationTypes(): ActiveObservationTypes {
  return useContext(ActiveObservationTypesContext);
}
