import type { Firestore } from 'firebase-admin/firestore';
import {
  observationAccessFor,
  type ObservationAccess,
  type ObservationParticipants,
} from '@ops/shared';
import { callerMeetsAccessLevel } from './callerAccess.js';

/**
 * The caller's relationship to an observation (see observationAccessFor in
 * @ops/shared and the /observations rules). Owner and co-observer resolve
 * from the doc alone; oversight (Full Access or hasAdminAccess) re-reads the
 * live staff doc via callerMeetsAccessLevel('console'). A building
 * Administrator or Peer Evaluator who is neither owner nor co-observer gets
 * no access (or 'observed' for their own observation as a teacher).
 */
export async function callerObservationAccess(
  db: Firestore,
  obs: ObservationParticipants,
  args: { email: string; tokenRole: string | null | undefined },
): Promise<ObservationAccess> {
  const direct = observationAccessFor(obs, args.email, false);
  if (direct === 'owner' || direct === 'coObserver') return direct;
  const oversight = await callerMeetsAccessLevel(db, {
    email: args.email,
    tokenRole: args.tokenRole,
    level: 'console',
  });
  return oversight ? 'oversight' : direct;
}
