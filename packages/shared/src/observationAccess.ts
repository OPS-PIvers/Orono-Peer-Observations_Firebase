import { canOpenAdminConsole } from './roles.js';

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
 * - oversight:  console admins (Full Access, or the hasAdminAccess flag).
 *               Everything, including reopening finalized observations.
 * - observed:   the staff member being observed.
 * - null:       no access. Peer Evaluators and building Administrators
 *               never see observations they don't own or co-observe.
 */
export type ObservationAccess = 'owner' | 'coObserver' | 'oversight' | 'observed' | null;

/** District-level oversight of every observation. */
export function hasObservationOversight(
  role: string | null | undefined,
  hasAdminAccess: boolean | null | undefined,
): boolean {
  return canOpenAdminConsole(role, hasAdminAccess);
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
  if (oversight) return 'oversight';
  if (is(obs.observedEmail)) return 'observed';
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
