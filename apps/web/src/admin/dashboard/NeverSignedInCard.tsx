import { useCallback, useMemo, useState } from 'react';
import { where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { MailPlus, UserRoundX } from 'lucide-react';
import { COLLECTIONS, type Staff } from '@ops/shared';
import { functions } from '@/lib/firebase';
import { useFirestoreCollection } from '@/hooks/useFirestoreCollection';
import { toJsDate } from '@/utils/staffFormatting';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Admin rollout-readiness card (PLAT-10): active staff who were added to the
 * roster — and so were sent a `staff.created` invite — but have never signed
 * in, each with a one-click "Resend invite".
 *
 * The query is deliberately plain: `syncMyClaims` denormalizes a
 * `lastSignInAt` stamp onto the staff doc on every sign-in, so "never signed
 * in" is a two-equality-filter query rather than a group-by over /auditLog
 * (which Firestore cannot express). Two equality filters on a single
 * collection are served by merging single-field indexes, so this needs no
 * composite index — same reasoning as StaffPage's other admin queries.
 *
 * Caveat worth remembering: `lastSignInAt == null` matches only documents
 * where the field is *present and null*. Every staff-creation path writes an
 * explicit null, and scripts/backfill/backfill-last-sign-in.ts fills in docs
 * that predate the field. A staff doc that somehow omits the field is
 * invisible here.
 *
 * Renders nothing while loading or when nobody is outstanding — matching the
 * EmailFailuresCard idiom on the Audit Log page, so a healthy roster costs no
 * vertical space.
 */

const NEVER_SIGNED_IN_CONSTRAINTS = [
  where('isActive', '==', true),
  where('lastSignInAt', '==', null),
];

/** Disambiguates this subscription from other /staff queries in the cache —
 *  QueryConstraint only exposes its *type*, so two `where`-shaped queries
 *  would otherwise collide on the same key (see useFirestoreCollection). */
const QUERY_KEY_PARTS = ['never-signed-in'];

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

  const rows = useMemo(
    () => (data ?? []).slice().sort((a, b) => a.name.localeCompare(b.name)),
    [data],
  );

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
      <CardHeader className="flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2">
          <UserRoundX className="text-ops-blue size-4" aria-hidden="true" />
          Invited but never signed in
        </CardTitle>
        <span className="text-muted-foreground text-xs">
          {rows.length} of your active staff {rows.length === 1 ? 'has' : 'have'} not signed in yet
        </span>
      </CardHeader>
      <CardContent className="pt-3">
        {resendError ? <p className="text-ops-red-dark mb-3 text-sm">{resendError}</p> : null}
        <ul className="divide-border divide-y text-sm">
          {rows.map((s) => {
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
    </Card>
  );
}
