import { isSummative, type CycleStatusStaff } from './cycle.js';
import { SPECIAL_ROLES } from './roles.js';

export interface ObserverScope {
  role: string | null | undefined;
  /** The observer's own buildings (their staff doc, or dev-mode's override). */
  buildings: readonly string[];
}

export interface ObservableStaff extends CycleStatusStaff {
  isActive: boolean;
  buildings: readonly string[];
}

/**
 * Why `observer` may not start an observation of `staff`, or null when they
 * may. Building Administrators observe only active, summative (Probationary
 * or High Cycle) staff in one of their own buildings; Peer Evaluators and
 * Full Access keep district-wide access. Checked at creation only, so an
 * observation already underway can still be finished if the person later
 * falls out of scope.
 */
export function observeBlockReason(observer: ObserverScope, staff: ObservableStaff): string | null {
  if (observer.role !== SPECIAL_ROLES.administrator) return null;
  if (!staff.isActive) return 'Archived staff can’t be observed';
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Firestore reads bypass Zod defaults; older docs may lack this field
  if (!(staff.buildings ?? []).some((b) => observer.buildings.includes(b))) {
    return 'Not in your building';
  }
  if (!isSummative(staff)) return 'Only Probationary and High Cycle staff can be observed';
  return null;
}

export function canObserve(observer: ObserverScope, staff: ObservableStaff): boolean {
  return observeBlockReason(observer, staff) === null;
}
