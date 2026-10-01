import { useEffect, useState } from 'react';
import { onIdTokenChanged } from 'firebase/auth';
import { DEMO_EDIT_CLAIM } from '@ops/shared';
import { auth } from '@/lib/firebase';

/**
 * Who is driving this session through View As + Edit, or null for a normal
 * session. Read off the ID token's DEMO_EDIT_CLAIM, which only the
 * startViewAsEdit callable's custom token carries.
 */
export function useDemoEditSession(): string | null {
  const [demoEditBy, setDemoEditBy] = useState<string | null>(null);
  useEffect(
    () =>
      onIdTokenChanged(auth, (user) => {
        if (!user) {
          setDemoEditBy(null);
          return;
        }
        void user
          .getIdTokenResult()
          .then((result) => {
            const by = result.claims[DEMO_EDIT_CLAIM];
            setDemoEditBy(typeof by === 'string' ? by : null);
          })
          .catch(() => setDemoEditBy(null));
      }),
    [],
  );
  return demoEditBy;
}
