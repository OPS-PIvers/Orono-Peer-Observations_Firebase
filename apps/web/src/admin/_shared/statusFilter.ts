export type StatusFilter = 'all' | 'active' | 'archived';

/**
 * Default status filter used across every admin list page (Staff, Roles,
 * Buildings) so all three behave the same way out of the box: show only
 * active rows until the admin opts into Archived or All.
 */
export const DEFAULT_STATUS_FILTER: StatusFilter = 'active';

/**
 * Pure predicate behind every admin status filter: 'active' hides
 * inactive rows, 'archived' shows only inactive rows, 'all' shows
 * everything. Shared by StaffPage, RolesPage, and BuildingsPage so the
 * three stay in lockstep if the semantics ever change.
 */
export function matchesStatusFilter(isActive: boolean, statusFilter: StatusFilter): boolean {
  if (statusFilter === 'active') return isActive;
  if (statusFilter === 'archived') return !isActive;
  return true;
}
