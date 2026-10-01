import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search, Wrench, X } from 'lucide-react';
import { COLLECTIONS, SPECIAL_ROLES, isSpecialRole, type Role, type Staff } from '@ops/shared';
import { useFirestoreCollection } from '@/hooks/useFirestoreCollection';
import { cn } from '@/lib/utils';
import { roleDisplayName } from '@/utils/roleLookup';
import { useDevMode } from './DevModeContext';

type RoleFilter = 'all' | 'administrator' | 'peer-evaluator' | 'full-access' | 'staff';

const ROLE_FILTERS: { value: RoleFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: SPECIAL_ROLES.administrator, label: 'Admin' },
  { value: SPECIAL_ROLES.peerEvaluator, label: 'PE' },
  { value: SPECIAL_ROLES.fullAccess, label: 'Full Access' },
  { value: 'staff', label: 'Staff' },
];

const MAX_RESULTS = 50;

function matchesRole(s: Staff, filter: RoleFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'staff') return !isSpecialRole(s.role);
  return s.role === filter;
}

/**
 * Header pill for dev users: view the app as any real staff member
 * (read-only). See DevModeProvider.
 */
export function DevModeBar() {
  const { viewAsEmail, viewAsStaff, setViewAs, clear, isDevUser } = useDevMode();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Only loaded once the panel opens: the roster is large.
  const { data: allStaff } = useFirestoreCollection<Staff>(
    isDevUser && open ? COLLECTIONS.staff : '',
  );
  const { data: roles } = useFirestoreCollection<Role>(isDevUser && open ? COLLECTIONS.roles : '');

  const results = useMemo(() => {
    if (!allStaff) return [];
    const q = query.trim().toLowerCase();
    return allStaff
      .filter((s) => s.isActive && matchesRole(s, roleFilter))
      .filter(
        (s) =>
          !q ||
          s.name.toLowerCase().includes(q) ||
          s.email.toLowerCase().includes(q) ||
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Firestore reads bypass Zod defaults; older docs may lack this field
          (s.buildings ?? []).some((b) => b.toLowerCase().includes(q)),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [allStaff, query, roleFilter]);

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
    function onClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!isDevUser) return null;

  const viewing = viewAsEmail !== null;
  const pillLabel = viewing ? (viewAsStaff?.name.split(' ')[0] ?? viewAsEmail) : 'Me';

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          'inline-flex max-w-[14rem] items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors',
          viewing
            ? 'bg-amber-500 text-white hover:bg-amber-600'
            : 'bg-white/10 text-white hover:bg-white/20',
        )}
        title="View the app as another staff member"
      >
        <Wrench className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">DEV: {pillLabel}</span>
        <ChevronDown
          className={cn('h-3.5 w-3.5 shrink-0 transition-transform', open && 'rotate-180')}
        />
      </button>
      {open ? (
        <div className="text-ops-gray-dark absolute top-full right-0 z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-gray-200 bg-white shadow-xl">
          <div className="bg-ops-blue-dark flex items-center justify-between rounded-t-lg px-3 py-2 text-white">
            <span className="font-heading flex items-center gap-1.5 text-sm font-semibold">
              <Wrench className="h-3.5 w-3.5" /> View as
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="rounded p-0.5 hover:bg-white/10"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="space-y-2 p-2">
            <p className="text-ops-gray px-1 text-[11px]">
              Renders the app exactly as that person sees it. Read-only: nothing you do is saved.
            </p>
            {viewing ? (
              <button
                type="button"
                onClick={() => {
                  clear();
                  setOpen(false);
                }}
                className="text-ops-red w-full rounded border border-red-200 px-2 py-1.5 text-left text-xs font-medium hover:bg-red-50"
              >
                Exit view-as ({viewAsStaff?.name ?? viewAsEmail})
              </button>
            ) : null}
            <div className="relative">
              <Search className="text-ops-gray pointer-events-none absolute top-1/2 left-2 h-3.5 w-3.5 -translate-y-1/2" />
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Name, email or building"
                aria-label="Search staff"
                className="border-input h-9 w-full rounded-md border bg-white pr-2 pl-7 text-sm"
              />
            </div>
            <div role="group" aria-label="Filter by role" className="flex flex-wrap gap-1">
              {ROLE_FILTERS.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  aria-pressed={roleFilter === f.value}
                  onClick={() => setRoleFilter(f.value)}
                  className={cn(
                    'rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors',
                    roleFilter === f.value
                      ? 'bg-ops-blue text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200',
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <ul className="max-h-72 overflow-y-auto" aria-label="Staff">
              {!allStaff ? (
                <li className="text-ops-gray px-2 py-3 text-xs">Loading staff…</li>
              ) : results.length === 0 ? (
                <li className="text-ops-gray px-2 py-3 text-xs">No active staff match.</li>
              ) : (
                results.slice(0, MAX_RESULTS).map((s) => {
                  const active = s.email.toLowerCase() === viewAsEmail;
                  return (
                    <li key={s.email}>
                      <button
                        type="button"
                        onClick={() => {
                          setViewAs(s.email);
                          setOpen(false);
                        }}
                        className={cn(
                          'w-full rounded px-2 py-1.5 text-left transition-colors',
                          active ? 'bg-ops-blue-lighter' : 'hover:bg-gray-50',
                        )}
                      >
                        <span className="block truncate text-sm font-medium">{s.name}</span>
                        <span className="text-ops-gray block truncate text-[11px]">
                          {roleDisplayName(roles, s.role)}
                          {/* eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Firestore reads bypass Zod defaults */}
                          {(s.buildings ?? []).length > 0 ? ` · ${s.buildings.join(', ')}` : ''}
                        </span>
                      </button>
                    </li>
                  );
                })
              )}
              {results.length > MAX_RESULTS ? (
                <li className="text-ops-gray px-2 py-2 text-[11px] italic">
                  Showing {MAX_RESULTS} of {results.length}. Search to narrow.
                </li>
              ) : null}
            </ul>
          </div>
        </div>
      ) : null}
    </div>
  );
}
