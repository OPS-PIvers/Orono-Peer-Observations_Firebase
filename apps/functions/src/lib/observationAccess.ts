import type { Firestore } from 'firebase-admin/firestore';
import {
  observationAccessFor,
  type ObservationAccess,
  type ObservationParticipants,
} from '@ops/shared';
import { callerMeetsAccessLevel } from './callerAccess.js';
import { isDemoEditSession, isDemoStaff } from './callable.js';

/**
 * The caller's relationship to an observation (see observationAccessFor in
 * @ops/shared and the /observations rules). Owner and co-observer resolve
 * from the doc alone; oversight (Full Access only — not hasAdminAccess)
 * re-reads the live staff doc via callerMeetsAccessLevel('oversight'). The
 * observed staff member is always just 'observed', even with oversight. A
 * building Administrator or Peer Evaluator who is neither owner nor
 * co-observer gets no access.
 */
export async function callerObservationAccess(
  db: Firestore,
  obs: ObservationParticipants,
  args: {
    email: string;
    tokenRole: string | null | undefined;
    /** The caller's auth: a demo-edit session only reaches demo staff's
     *  observations (see lib/callable.ts). Required so no caller can forget
     *  it; pass null only where there is genuinely no request. */
    auth: { token: Record<string, unknown> } | null | undefined;
  },
): Promise<ObservationAccess> {
  if (isDemoEditSession(args.auth) && !(await isDemoStaff(db, obs.observedEmail))) return null;
  const direct = observationAccessFor(obs, args.email, false);
  if (direct) return direct;
  const oversight = await callerMeetsAccessLevel(db, {
    email: args.email,
    tokenRole: args.tokenRole,
    level: 'oversight',
  });
  return oversight ? 'oversight' : null;
}
