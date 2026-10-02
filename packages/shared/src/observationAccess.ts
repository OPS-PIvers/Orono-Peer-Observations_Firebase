import { SPECIAL_ROLES } from './roles.js';

/**
 * Who may do what with an observation. Mirrors the /observations rules in
 * firestore.rules — keep the two in sync.
 *
 * - owner:      the observer who created it. Full control of the Draft:
 *               content, finalize, delete, teacher visibility, co-observers.
 * - coObserver: someone the owner shared it with (a principal and associate
 *               principal observing together). Views it and edits the
 *               Draft's content; finalize, delete and sharing stay with the
 *               owner.
 * - oversight:  the Full Access role. Everything, including reopening
 *               finalized observations — except their own observation,
 *               where they are only the observed staff member. Admin
 *               Console access (the hasAdminAccess flag) does NOT grant it.
 * - observed:   the staff member being observed. Wins over oversight.
 * - null:       no access. Peer Evaluators and building Administrators
 *               never see observations they don't own or co-observe.
 */
export type ObservationAccess = 'owner' | 'coObserver' | 'oversight' | 'observed' | null;

/** District-level oversight of every observation: Full Access only.
 *  Deliberately independent of Admin Console access — a Peer Evaluator or
 *  specialist with hasAdminAccess manages the console, not other people's
 *  observations. Mirrored by hasObservationOversight() in firestore.rules. */
export function hasObservationOversight(role: string | null | undefined): boolean {
  return role === SPECIAL_ROLES.fullAccess;
}

export interface ObservationParticipants {
  observerEmail: string;
  observedEmail: string;
  coObserverEmails?: readonly string[] | undefined;
}

export function observationAccessFor(
  obs: ObservationParticipants,
  email: string | null | undefined,
  oversight: boolean,
): ObservationAccess {
  const me = email?.toLowerCase() ?? '';
  // Raw Admin SDK reads skip schema defaults, so don't trust field presence.
  const is = (value: unknown) =>
    me !== '' && typeof value === 'string' && value.toLowerCase() === me;
  const coObservers: unknown = obs.coObserverEmails;
  if (is(obs.observerEmail)) return 'owner';
  if (Array.isArray(coObservers) && coObservers.some(is)) return 'coObserver';
  // Your own observation is never yours to oversee.
  if (is(obs.observedEmail)) return 'observed';
  if (oversight) return 'oversight';
  return null;
}

/** May edit the Draft's content (rubric, notes, script, evidence, audio). */
export function canEditObservationContent(access: ObservationAccess): boolean {
  return access === 'owner' || access === 'coObserver' || access === 'oversight';
}

/** May finalize, delete, share, or change teacher visibility. */
export function canManageObservation(access: ObservationAccess): boolean {
  return access === 'owner' || access === 'oversight';
}
