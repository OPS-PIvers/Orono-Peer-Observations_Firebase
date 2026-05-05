import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Wrench, X } from 'lucide-react';
import { COLLECTIONS, SPECIAL_ROLES, type Staff } from '@ops/shared';
import { useFirestoreCollection } from '@/hooks/useFirestoreCollection';
import { cn } from '@/lib/utils';
import { useDevMode, type DevRoleOverride } from './DevModeContext';

const ROLE_OPTIONS: { value: DevRoleOverride; label: string }[] = [
  { value: null, label: 'Real role' },
  { value: SPECIAL_ROLES.administrator, label: 'Administrator' },
  { value: SPECIAL_ROLES.peerEvaluator, label: 'Peer Evaluator' },
  { value: SPECIAL_ROLES.fullAccess, label: 'Full Access' },
];

function shortLabel(role: DevRoleOverride): string {
  switch (role) {
    case SPECIAL_ROLES.administrator:
      return 'Admin';
    case SPECIAL_ROLES.peerEvaluator:
      return 'PE';
    case SPECIAL_ROLES.fullAccess:
      return 'Full Access';
    default:
      return 'Real';
  }
}

export function DevModeBar() {
  const { override, setRole, setBuilding, clear, isDevUser } = useDevMode();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const { data: allStaff } = useFirestoreCollection<Staff>(isDevUser ? COLLECTIONS.staff : '');
  const buildings = useMemo(() => {
    const set = new Set<string>();
    allStaff?.forEach((s) => s.buildings.forEach((b) => set.add(b)));
    return Array.from(set).sort();
  }, [allStaff]);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  if (!isDevUser) return null;

  const isOverridden = override.role !== null;

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors',
          isOverridden
            ? 'bg-amber-500 text-white hover:bg-amber-600'
            : 'bg-white/10 hover:bg-white/20 text-white',
        )}
        title="Open dev mode"
      >
        <Wrench className="h-3.5 w-3.5" />
        DEV: {shortLabel(override.role)}
        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
      </button>
      {open ? (
        <div className="absolute top-full right-0 z-50 mt-2 w-64 rounded-lg border border-gray-200 bg-white shadow-xl">
          <div className="bg-ops-blue-dark flex items-center justify-between rounded-t-lg px-3 py-2 text-white">
            <span className="font-heading flex items-center gap-1.5 text-sm font-semibold">
              <Wrench className="h-3.5 w-3.5" /> Dev Mode
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
          <div className="space-y-1 p-2">
            {ROLE_OPTIONS.map((opt) => {
              const active = override.role === opt.value;
              return (
                <button
                  key={opt.label}
                  type="button"
                  onClick={() => setRole(opt.value)}
                  className={cn(
                    'flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm transition-colors',
                    active
                      ? 'bg-ops-blue-lighter text-ops-blue-dark font-medium'
                      : 'hover:bg-gray-50',
                  )}
                >
                  <span>{opt.label}</span>
                  {active ? (
                    <span className="bg-ops-blue h-2 w-2 rounded-full" aria-hidden="true" />
                  ) : null}
                </button>
              );
            })}
            {override.role === SPECIAL_ROLES.administrator ? (
              <label className="block pt-2">
                <span className="text-ops-gray block text-[11px] font-semibold tracking-wide uppercase">
                  Building
                </span>
                <select
                  value={override.building ?? ''}
                  onChange={(e) => setBuilding(e.target.value || null)}
                  className="border-input mt-1 h-9 w-full rounded-md border bg-white px-2 text-sm"
                >
                  <option value="">Pick a building…</option>
                  {buildings.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
                {override.building === null ? (
                  <p className="text-ops-gray mt-1 text-[11px] italic">
                    My Staff will show empty until you pick one.
                  </p>
                ) : null}
              </label>
            ) : null}
            {isOverridden ? (
              <button
                type="button"
                onClick={() => {
                  clear();
                }}
                className="text-ops-red mt-2 w-full rounded px-2 py-1.5 text-left text-xs hover:bg-red-50"
              >
                Clear override
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
