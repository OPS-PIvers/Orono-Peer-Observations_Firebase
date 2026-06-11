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
 * Resolve a role from the loaded /roles collection by roleId slug (fast path)
 * or by displayName equality (legacy fallback for un-migrated docs).
 *
 * Mirrors the server-side resolveRole logic so legacy observations remain
 * viewable in the editor.
 *
 * Returns the matched role or null if no match is found.
 */
export function resolveRole(
  roles: readonly Role[] | null | undefined,
  roleValue: string | null | undefined,
): Role | null {
  if (!roleValue || !roles) return null;

  // Fast path: match by roleId slug.
  const bySlug = roles.find((r) => r.roleId === roleValue);
  if (bySlug) return bySlug;

  // Legacy fallback: match by displayName equality.
  return roles.find((r) => r.displayName === roleValue) ?? null;
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
