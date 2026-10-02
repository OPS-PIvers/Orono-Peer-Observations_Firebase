import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { signInWithCustomToken, signOut } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { Eye, PencilLine } from 'lucide-react';
import { COLLECTIONS, SPECIAL_ROLES, type Role } from '@ops/shared';
import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { useFirestoreCollection } from '@/hooks/useFirestoreCollection';
import { auth, functions } from '@/lib/firebase';
import { roleDisplayName } from '@/utils/roleLookup';
import { useDevMode } from './DevModeContext';

const startViewAsEditFn = httpsCallable<{ email: string }, { token: string }>(
  functions,
  'startViewAsEdit',
);

/** Roles Edits can be turned on for (mirrors startViewAsEdit). */
const EDITABLE_ROLES: readonly string[] = [
  SPECIAL_ROLES.administrator,
  SPECIAL_ROLES.peerEvaluator,
];

/**
 * Persistent strip under the header while viewing as someone (read-only),
 * with an Edits switch for people granted View As + Edit; or, inside an
 * edit session, a strip saying so with the way out.
 */
export function ViewAsBanner() {
  const { viewAsEmail, viewAsStaff, viewAsLoading, clear, canEditAs, demoEditBy } = useDevMode();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data: roles } = useFirestoreCollection<Role>(viewAsEmail ? COLLECTIONS.roles : '');
  const [confirming, setConfirming] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (demoEditBy) {
    return (
      <div
        role="status"
        className="flex items-center gap-3 border-b border-red-300 bg-red-50 px-4 py-1.5 text-sm text-red-950"
      >
        <PencilLine className="h-4 w-4 shrink-0" aria-hidden="true" />
        <p className="min-w-0 flex-1 truncate">
          Editing as <strong>{user?.displayName ?? user?.email}</strong> (demo). Only demo people
          can be changed, and no email about them is sent.
        </p>
        <button
          type="button"
          onClick={() => {
            void signOut(auth).then(() => navigate('/sign-in', { replace: true }));
          }}
          className="shrink-0 rounded border border-red-300 bg-white px-2 py-0.5 text-xs font-semibold hover:bg-red-100"
        >
          Exit and sign in as yourself
        </button>
      </div>
    );
  }

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
  const canEditThisPerson = canEditAs && !!viewAsStaff && EDITABLE_ROLES.includes(viewAsStaff.role);

  async function startEditing() {
    if (!viewAsEmail) return;
    setStarting(true);
    setError(null);
    try {
      const { data } = await startViewAsEditFn({ email: viewAsEmail });
      clear();
      await signInWithCustomToken(auth, data.token);
      setConfirming(false);
      void navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not turn on edits.');
    } finally {
      setStarting(false);
    }
  }

  return (
    <>
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
        {canEditThisPerson ? (
          <div className="flex shrink-0 items-center gap-1.5 text-xs font-semibold">
            <span aria-hidden="true">Edits</span>
            <Switch
              checked={false}
              onCheckedChange={(on) => {
                if (on) setConfirming(true);
              }}
              aria-label="Turn on edits"
            />
          </div>
        ) : null}
        <button
          type="button"
          onClick={clear}
          className="shrink-0 rounded border border-amber-400 bg-white px-2 py-0.5 text-xs font-semibold hover:bg-amber-50"
        >
          Exit
        </button>
      </div>

      <Dialog open={confirming} onOpenChange={(open) => !starting && setConfirming(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Turn on edits as {viewAsStaff?.name}?</DialogTitle>
            <DialogDescription>
              You&apos;ll be signed in as {viewAsStaff?.name} and can click through the app for
              real. Changes are limited to demo people (such as Sample Teacher), and no email about
              them is sent. Everything else stays read-only. To stop, use Exit in the banner and
              sign back in as yourself.
            </DialogDescription>
          </DialogHeader>
          {error ? (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button variant="outline" disabled={starting} onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button disabled={starting} onClick={() => void startEditing()}>
              {starting ? 'Turning on…' : 'Turn on edits'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
