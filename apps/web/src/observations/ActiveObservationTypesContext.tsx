import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useActiveWorkProductObservation } from '@/hooks/useActiveWorkProductObservation';
import { useActiveInstructionalRoundObservation } from '@/hooks/useActiveInstructionalRoundObservation';

interface ActiveObservationTypes {
  hasWorkProduct: boolean;
  hasInstructionalRound: boolean;
}

export const ActiveObservationTypesContext = createContext<ActiveObservationTypes>({
  hasWorkProduct: false,
  hasInstructionalRound: false,
});

export function ActiveObservationTypesProvider({
  email,
  children,
}: {
  email: string;
  children: ReactNode;
}) {
  const { observation: wp } = useActiveWorkProductObservation(email);
  const { observation: ir } = useActiveInstructionalRoundObservation(email);
  const value = useMemo(
    () => ({
      hasWorkProduct: !!wp,
      hasInstructionalRound: !!ir,
    }),
    [wp, ir],
  );
  return (
    <ActiveObservationTypesContext value={value}>
      {children}
    </ActiveObservationTypesContext>
  );
}

export function useActiveObservationTypes(): ActiveObservationTypes {
  return useContext(ActiveObservationTypesContext);
}
