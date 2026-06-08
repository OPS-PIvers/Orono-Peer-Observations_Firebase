import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { Observation } from '@ops/shared';
import { useActiveStandardObservation } from '@/hooks/useActiveStandardObservation';
import { useActiveWorkProductObservation } from '@/hooks/useActiveWorkProductObservation';
import { useActiveInstructionalRoundObservation } from '@/hooks/useActiveInstructionalRoundObservation';

type ActiveObservation = (Observation & { id: string }) | null;

interface ActiveObservationTypes {
  /** Most recent Draft observation of each type where the user is observed. */
  standard: ActiveObservation;
  workProduct: ActiveObservation;
  instructionalRound: ActiveObservation;
  hasWorkProduct: boolean;
  hasInstructionalRound: boolean;
}

export const ActiveObservationTypesContext = createContext<ActiveObservationTypes>({
  standard: null,
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
 */
export function ActiveObservationTypesProvider({
  email,
  children,
}: {
  email: string;
  children: ReactNode;
}) {
  const { observation: standard } = useActiveStandardObservation(email);
  const { observation: wp } = useActiveWorkProductObservation(email);
  const { observation: ir } = useActiveInstructionalRoundObservation(email);
  const value = useMemo<ActiveObservationTypes>(
    () => ({
      standard: standard ?? null,
      workProduct: wp ?? null,
      instructionalRound: ir ?? null,
      hasWorkProduct: !!wp,
      hasInstructionalRound: !!ir,
    }),
    [standard, wp, ir],
  );
  return <ActiveObservationTypesContext value={value}>{children}</ActiveObservationTypesContext>;
}

export function useActiveObservationTypes(): ActiveObservationTypes {
  return useContext(ActiveObservationTypesContext);
}
