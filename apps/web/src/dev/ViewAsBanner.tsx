import { Eye } from 'lucide-react';
import { COLLECTIONS, type Role } from '@ops/shared';
import { useFirestoreCollection } from '@/hooks/useFirestoreCollection';
import { roleDisplayName } from '@/utils/roleLookup';
import { useDevMode } from './DevModeContext';

/** Persistent strip under the header while viewing as someone. */
export function ViewAsBanner() {
  const { viewAsEmail, viewAsStaff, viewAsLoading, clear } = useDevMode();
  const { data: roles } = useFirestoreCollection<Role>(viewAsEmail ? COLLECTIONS.roles : '');
  if (!viewAsEmail) return null;

  const missing = !viewAsLoading && !viewAsStaff;
  const detail = viewAsStaff
    ? [
        roleDisplayName(roles, viewAsStaff.role),
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Firestore reads bypass Zod defaults
        (viewAsStaff.buildings ?? []).join(', '),
      ]
        .filter(Boolean)
        .join(' · ')
    : null;

  return (
    <div
      role="status"
      className="flex items-center gap-3 border-b border-amber-300 bg-amber-100 px-4 py-1.5 text-sm text-amber-950"
    >
      <Eye className="h-4 w-4 shrink-0" aria-hidden="true" />
      <p className="min-w-0 flex-1 truncate">
        {missing ? (
          <>No staff record for {viewAsEmail}.</>
        ) : (
          <>
            Viewing as <strong>{viewAsStaff?.name ?? viewAsEmail}</strong>
            {detail ? ` (${detail})` : null}. Read-only.
          </>
        )}
      </p>
      <button
        type="button"
        onClick={clear}
        className="shrink-0 rounded border border-amber-400 bg-white px-2 py-0.5 text-xs font-semibold hover:bg-amber-50"
      >
        Exit
      </button>
    </div>
  );
}
