import { useCallback, useMemo, useState } from 'react';
import { where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { ChevronDown, ChevronRight, MailPlus, UserRoundX } from 'lucide-react';
import { COLLECTIONS, type Staff } from '@ops/shared';
import { functions } from '@/lib/firebase';
import { useFirestoreCollection } from '@/hooks/useFirestoreCollection';
import { toJsDate } from '@/utils/staffFormatting';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AdminSearchInput } from '@/admin/_shared/AdminSearchInput';

/**
 * Admin rollout-readiness card (PLAT-10): active staff who were added to the
 * roster — and so were sent a `staff.created` invite — but have never signed
 * in, each with a one-click "Resend invite".
 *
 * The Firestore query only filters `isActive == true` — a single equality
 * filter needs no composite index, same reasoning as StaffPage's other admin
 * queries. "Never signed in" (lastSignInAt is null OR the field is absent
 * entirely, on docs that predate the stamp) is deliberately checked in JS
 * rather than as a second `where('lastSignInAt', '==', null)` filter:
 * Firestore equality filters only match documents where the field is
 * *present*, so a staff doc that simply omits the field would silently never
 * match that filter and would vanish from this card. Querying the broader
 * `isActive == true` set and filtering client-side is immune to that trap,
 * and costs nothing meaningful — StaffPage already loads the entire staff
 * collection on this same page.
 *
 * Renders nothing while loading or when nobody is outstanding — matching the
 * EmailFailuresCard idiom on the Audit Log page, so a healthy roster costs no
 * vertical space.
 */

const NEVER_SIGNED_IN_CONSTRAINTS = [where('isActive', '==', true)];

/** Disambiguates this subscription from other /staff queries in the cache —
 *  QueryConstraint only exposes its *type*, so two `where`-shaped queries
 *  would otherwise collide on the same key (see useFirestoreCollection). */
const QUERY_KEY_PARTS = ['never-signed-in'];

/** `lastSignInAt` is `null` on docs the sign-in path hasn't stamped yet, or
 *  absent entirely on docs created before the field existed. Raw Firestore
 *  reads bypass Zod defaults, so the value really can be `undefined` at
 *  runtime even though the `Staff` type says otherwise — widen the type
 *  before checking so both cases are handled explicitly. */
function hasNeverSignedIn(s: Staff): boolean {
  const lastSignInAt = s.lastSignInAt as Date | null | undefined;
  return lastSignInAt === null || lastSignInAt === undefined;
}

const resendStaffInviteFn = httpsCallable<{ email: string }, { sent: boolean }>(
  functions,
  'resendStaffInvite',
);

type ResendState = 'sending' | 'sent' | 'no-template' | 'error';

export function NeverSignedInCard() {
  const { data, loading, error } = useFirestoreCollection<Staff>(
    COLLECTIONS.staff,
    NEVER_SIGNED_IN_CONSTRAINTS,
    QUERY_KEY_PARTS,
  );

  const [resend, setResend] = useState<Record<string, ResendState>>({});
  const [resendError, setResendError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState('');

  const rows = useMemo(
    () => (data ?? []).filter(hasNeverSignedIn).sort((a, b) => a.name.localeCompare(b.name)),
    [data],
  );

  const q = query.trim().toLowerCase();
  const visible = q
    ? rows.filter((s) => s.name.toLowerCase().includes(q) || s.email.toLowerCase().includes(q))
    : rows;

  const handleResend = useCallback(async (email: string) => {
    setResendError(null);
    setResend((s) => ({ ...s, [email]: 'sending' }));
    try {
      const result = await resendStaffInviteFn({ email });
      setResend((s) => ({ ...s, [email]: result.data.sent ? 'sent' : 'no-template' }));
    } catch (err) {
      setResend((s) => ({ ...s, [email]: 'error' }));
      setResendError(err instanceof Error ? err.message : 'Failed to resend invite');
    }
  }, []);

  if (error) {
    return (
      <Card className="mb-4">
        <CardContent className="text-ops-red-dark text-sm">
          Failed to load staff sign-in status: {error.message}
        </CardContent>
      </Card>
    );
  }

  if (loading || rows.length === 0) return null;

  return (
    <Card className="mb-4">
      {/* The whole header is the expand/collapse control. Collapsed by
          default: during rollout this card can hold most of the roster, and
          an open card that long buries the staff table (and its search bar)
          below the fold. */}
      <CardHeader className="p-0">
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
          className="flex w-full flex-row flex-wrap items-center justify-between gap-2 px-6 py-4 text-left"
        >
          <CardTitle className="flex items-center gap-2">
            {expanded ? (
              <ChevronDown className="text-muted-foreground size-4" aria-hidden="true" />
            ) : (
              <ChevronRight className="text-muted-foreground size-4" aria-hidden="true" />
            )}
            <UserRoundX className="text-ops-blue size-4" aria-hidden="true" />
            Invited but never signed in
          </CardTitle>
          <span className="text-muted-foreground text-xs">
            {rows.length} of your active staff {rows.length === 1 ? 'has' : 'have'} not signed in
            yet
          </span>
        </button>
      </CardHeader>
      {expanded ? (
        <CardContent className="pt-0">
          {resendError ? <p className="text-ops-red-dark mb-3 text-sm">{resendError}</p> : null}
          <AdminSearchInput
            value={query}
            onChange={setQuery}
            placeholder="Search by name or email…"
            className="mb-3"
          />
          {q && visible.length === 0 ? (
            <p className="text-muted-foreground py-2 text-sm">No staff match that search.</p>
          ) : null}
          <ul className="divide-border divide-y text-sm">
            {visible.map((s) => {
              const state = resend[s.email];
              const invitedAt = toJsDate(s.createdAt);
              return (
                <li key={s.email} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                  <span className="font-medium">{s.name}</span>
                  <span className="text-muted-foreground text-xs">{s.email}</span>
                  {invitedAt ? (
                    <span className="text-muted-foreground text-xs">
                      added {invitedAt.toLocaleDateString()}
                    </span>
                  ) : null}
                  <span className="ml-auto flex items-center gap-2">
                    {state === 'sent' ? (
                      <span className="text-ops-blue text-xs">Invite re-sent</span>
                    ) : null}
                    {state === 'no-template' ? (
                      <span className="text-ops-red-dark text-xs">
                        No active “staff created” email template
                      </span>
                    ) : null}
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={state === 'sending'}
                      onClick={() => void handleResend(s.email)}
                      aria-label={`Resend invite to ${s.name}`}
                    >
                      <MailPlus />
                      {state === 'sending' ? 'Sending…' : 'Resend invite'}
                    </Button>
                  </span>
                </li>
              );
            })}
          </ul>
        </CardContent>
      ) : null}
    </Card>
  );
}
