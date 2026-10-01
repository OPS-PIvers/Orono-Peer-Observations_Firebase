import { useMemo, useState } from 'react';
import { doc, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import { UserPlus, X } from 'lucide-react';
import { COLLECTIONS, canCreateObservations, type Staff } from '@ops/shared';
import { db } from '@/lib/firebase';
import { useFirestoreCollection } from '@/hooks/useFirestoreCollection';
import { assertWritable } from '@/dev/viewAsGuard';

const MAX_CO_OBSERVERS = 10;
const MAX_SUGGESTIONS = 6;
const ACTIVE_STAFF = [where('isActive', '==', true)];

export interface CoObserversSectionProps {
  observationId: string;
  ownerEmail: string;
  observedEmail: string;
  /** Live coObserverEmails from the observation doc. */
  value: readonly string[];
}

/**
 * Owner-only control for who co-observes this observation (e.g. a principal
 * and associate principal observing together). Co-observers see it in their
 * lists and edit the Draft's content; finalize, delete and sharing stay with
 * the owner. Enforced by the /observations rules (see observationAccessFor).
 * Only people who can observe are offered.
 */
export function CoObserversSection({
  observationId,
  ownerEmail,
  observedEmail,
  value,
}: CoObserversSectionProps) {
  const { data: staff } = useFirestoreCollection<Staff>(COLLECTIONS.staff, ACTIVE_STAFF);
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const byEmail = useMemo(
    () => new Map((staff ?? []).map((s) => [s.email.toLowerCase(), s])),
    [staff],
  );

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !staff) return [];
    const taken = new Set([ownerEmail, observedEmail, ...value].map((e) => e.toLowerCase()));
    return staff
      .filter((s) => canCreateObservations(s.role) && !taken.has(s.email.toLowerCase()))
      .filter((s) => s.name.toLowerCase().includes(q) || s.email.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, MAX_SUGGESTIONS);
  }, [query, staff, ownerEmail, observedEmail, value]);

  async function save(next: string[]) {
    setSaving(true);
    setError(null);
    try {
      assertWritable();
      await updateDoc(doc(db, COLLECTIONS.observations, observationId), {
        coObserverEmails: next,
        lastModifiedAt: serverTimestamp(),
      });
      setQuery('');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  const full = value.length >= MAX_CO_OBSERVERS;

  return (
    <div className="space-y-2 border-t border-gray-100 pt-3">
      <div>
        <p className="text-ops-blue-dark text-sm font-semibold">Co-observers</p>
        <p className="text-muted-foreground mt-0.5 text-xs">
          They can see and edit this draft. Only you can finalize or delete it.
        </p>
      </div>
      {value.length > 0 ? (
        <ul className="space-y-1" aria-label="Co-observers">
          {value.map((email) => (
            <li key={email} className="flex items-center justify-between gap-2 text-sm">
              <span className="min-w-0 truncate">
                {byEmail.get(email.toLowerCase())?.name ?? email}
              </span>
              <button
                type="button"
                disabled={saving}
                onClick={() => void save(value.filter((e) => e !== email))}
                aria-label={`Remove ${byEmail.get(email.toLowerCase())?.name ?? email}`}
                className="text-ops-gray hover:text-ops-red rounded p-0.5 disabled:opacity-50"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {full ? null : (
        <div className="relative">
          <UserPlus className="text-ops-gray pointer-events-none absolute top-1/2 left-2 h-3.5 w-3.5 -translate-y-1/2" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Add a co-observer by name"
            aria-label="Add a co-observer"
            disabled={saving}
            className="border-input h-9 w-full rounded-md border bg-white pr-2 pl-7 text-sm"
          />
          {suggestions.length > 0 ? (
            <ul className="mt-1 rounded-md border border-gray-200 bg-white shadow-sm">
              {suggestions.map((s) => (
                <li key={s.email}>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void save([...value, s.email.toLowerCase()])}
                    className="w-full px-2 py-1.5 text-left hover:bg-gray-50 disabled:opacity-50"
                  >
                    <span className="block truncate text-sm">{s.name}</span>
                    <span className="text-muted-foreground block truncate text-[11px]">
                      {/* eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Firestore reads bypass Zod defaults */}
                      {(s.buildings ?? []).join(', ') || s.email}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : query.trim() && staff ? (
            <p className="text-muted-foreground mt-1 px-1 text-xs">
              No observers match. Only Administrators and Peer Evaluators can co-observe.
            </p>
          ) : null}
        </div>
      )}
      {error ? (
        <p className="border-destructive bg-ops-red-lighter text-ops-red-dark rounded-md border-l-4 px-3 py-2 text-xs">
          Could not update co-observers: {error}
        </p>
      ) : null}
    </div>
  );
}
