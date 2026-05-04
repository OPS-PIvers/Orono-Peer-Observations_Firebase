import type { Role } from '@ops/shared';

/**
 * Resolve a roleId slug to its human-readable displayName by scanning the
 * loaded /roles collection. Falls back to the input string if no match is
 * found — covers the legacy case where a staff record still holds a
 * pre-migration displayName, or a slug whose role doc was deleted.
 *
 * Pass `roles` from `useFirestoreCollection<Role>(COLLECTIONS.roles)`.
 */
export function roleDisplayName(
  roles: readonly Role[] | null | undefined,
  roleIdOrLegacy: string | null | undefined,
): string {
  if (!roleIdOrLegacy) return '';
  return roles?.find((r) => r.roleId === roleIdOrLegacy)?.displayName ?? roleIdOrLegacy;
}

/**
 * True if `value` matches a known roleId in the loaded /roles collection.
 * Useful for the StaffDialog dropdown's "unmapped" branch — a non-empty
 * value that isn't in the active list still needs to render so the admin
 * can see it before replacing.
 */
export function isKnownRoleId(
  roles: readonly Role[] | null | undefined,
  value: string | null | undefined,
): boolean {
  if (!value || !roles) return false;
  return roles.some((r) => r.roleId === value);
}
