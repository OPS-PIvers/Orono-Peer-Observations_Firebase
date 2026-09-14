import { isSummativeStatus, type CycleStatus } from '@ops/shared';
import { cycleStatusLabel } from '@/utils/staffFormatting';

export type BulkEditField =
  | 'year'
  | 'role'
  | 'addBuilding'
  | 'removeBuilding'
  | 'addModule'
  | 'removeModule'
  | 'hasAdminAccess'
  | 'isActive'
  | 'cycleStatus';

export interface BulkEditRisk {
  /** Question posed on the confirm step. */
  title: string;
  /** What actually happens to the selected people. */
  detail: string;
  /** Label for the button that commits the write. */
  confirmLabel: string;
}

const staffMembers = (count: number) => `${String(count)} staff member${count === 1 ? '' : 's'}`;

/**
 * Which bulk edits get a confirm step, and what that step says.
 *
 * Bulk edit writes to every selected row at once, and three of its nine
 * fields can take down the district's whole roster or hand out the admin
 * console: archiving, admin access, and the cycle status (which also sets
 * the summative flag). Those get the same two-step treatment
 * MessageGroupDialog already gives a broadcast. Everything else (year, role,
 * buildings, modules) is a routine correction an admin can undo by editing
 * again, so it stays one click.
 *
 * `value` is the boolean fields' chosen value; `status` the chosen cycle
 * status, read only for the `cycleStatus` field.
 *
 * Returns null when the edit needs no confirmation.
 */
export function describeBulkEditRisk(
  field: BulkEditField,
  value: boolean,
  count: number,
  status: CycleStatus = 'planning',
): BulkEditRisk | null {
  if (field === 'isActive' && !value) {
    return {
      title: `Archive ${staffMembers(count)}?`,
      detail:
        'They lose access to the app immediately and drop out of the default Staff list. Restoring them means finding them again under the Archived status filter.',
      confirmLabel: `Archive ${String(count)}`,
    };
  }
  if (field === 'hasAdminAccess') {
    return value
      ? {
          title: `Grant admin console access to ${staffMembers(count)}?`,
          detail:
            'Each of them will be able to read and change every staff record, rubric, observation, and setting in the district.',
          confirmLabel: `Grant access to ${String(count)}`,
        }
      : {
          title: `Revoke admin console access from ${staffMembers(count)}?`,
          detail:
            'They lose the admin console immediately — including you, if your own account is in the selection.',
          confirmLabel: `Revoke access from ${String(count)}`,
        };
  }
  if (field === 'cycleStatus') {
    const label = cycleStatusLabel(status);
    return {
      title: `Set the status of ${staffMembers(count)} to ${label}?`,
      detail: `This overrides where each person sits in their evaluation cycle, marks them ${
        isSummativeStatus(status) ? 'summative' : 'formative'
      } this year, and changes which status-based modules and materials they see. Their year is not changed.`,
      confirmLabel: `Set ${String(count)} to ${label}`,
    };
  }
  return null;
}
