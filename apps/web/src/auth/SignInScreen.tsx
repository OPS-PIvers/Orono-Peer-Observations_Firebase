import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { ALLOWED_EMAIL_DOMAIN } from '@ops/shared';
import { useAuth } from '@/auth/AuthProvider';
import { getBrandingCache } from '@/components/brandingCache';
import { Button } from '@/components/ui/button';

export function SignInScreen() {
  const { status } = useAuth();
  const branding = getBrandingCache();
  const [error, setError] = useState<string | null>(() => {
    // On initial render, check if there's a stored rejection message from
    // a previous sign-in attempt (e.g., in a redirect scenario).
    const stored = sessionStorage.getItem('signInError.rejectedEmail');
    if (stored) {
      sessionStorage.removeItem('signInError.rejectedEmail');
      return `Sign-in is restricted to @${ALLOWED_EMAIL_DOMAIN} accounts — you signed in as ${stored}`;
    }
    return null;
  });
  const [pending, setPending] = useState(false);

  // If the user already has a session (e.g., a stale tab where
  // AuthProvider just resolved an existing token), bounce off /sign-in.
  if (status === 'signed-in') {
    return <Navigate to="/" replace />;
  }
  if (status === 'loading') {
    return (
      <main
        className="bg-ops-gray-lightest flex min-h-svh items-center justify-center"
        role="status"
        aria-live="polite"
      >
        <div className="text-muted-foreground text-sm">Signing in…</div>
      </main>
    );
  }

  async function signIn() {
    setError(null);
    setPending(true);
    try {
      // Firebase Auth is imported on demand (only when the user actually
      // clicks "Continue with Google") so the Firebase SDK stays off the
      // initial critical path — the sign-in screen paints without it.
      const [{ GoogleAuthProvider, signInWithPopup }, { auth }] = await Promise.all([
        import('firebase/auth'),
        import('@/lib/firebase'),
      ]);
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ hd: ALLOWED_EMAIL_DOMAIN });
      // Popup, not redirect. Two reasons:
      //   1. Cross-origin storage partitioning breaks signInWithRedirect
      //      when the app is on a *.web.app preview channel and
      //      authDomain is *.firebaseapp.com — the post-redirect iframe
      //      bridge can't read auth state, getRedirectResult resolves
      //      null, the user is bounced back to /sign-in. Loop.
      //   2. Popup uses a direct postMessage from the popup window to
      //      the parent, which doesn't depend on third-party storage.
      // Chrome's COOP polling-block warnings appear in the console but
      // don't block sign-in completion (postMessage delivers the result
      // independently).
      const result = await signInWithPopup(auth, provider);

      // After successful sign-in, verify the user's email belongs to the
      // Orono domain. The GoogleAuthProvider's `hd` param restricts the
      // account chooser, but a determined user could still sign in with a
      // non-Orono account. If that happens, delete the just-created Auth
      // user and display a clear error message.
      if (result.user.email && !isAllowedEmail(result.user.email)) {
        try {
          await result.user.delete();
        } catch (deleteErr) {
          console.warn('Failed to delete non-domain auth user, signing out instead', deleteErr);
          // Fallback: if delete fails, sign out. This shouldn't happen for a
          // freshly-created user, but it's safer than leaving the user signed in.
          await auth.signOut();
        }
        sessionStorage.setItem('signInError.rejectedEmail', result.user.email);
        setError(
          `Sign-in is restricted to @${ALLOWED_EMAIL_DOMAIN} accounts — you signed in as ${result.user.email}`,
        );
        return;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sign-in failed. Please try again.';
      setError(message);
    } finally {
      setPending(false);
    }
  }

  function isAllowedEmail(email: string | null): boolean {
    if (!email) return false;
    return email.toLowerCase().endsWith(`@${ALLOWED_EMAIL_DOMAIN}`);
  }

  return (
    <main className="bg-ops-gray-lightest flex min-h-svh items-center justify-center px-4 py-12">
      <div className="border-border bg-background w-full max-w-md rounded-lg border p-8 shadow-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <img
            src={branding.logoUrl ?? '/brand/primary-logo.png'}
            alt="Orono Technology"
            className="mb-6 h-auto w-64"
            onError={(e) => {
              // Hide the broken image until logo PNGs are dropped into apps/web/public/brand/
              e.currentTarget.style.display = 'none';
            }}
          />
          <h1 className="font-heading text-ops-blue-dark text-2xl font-semibold">
            {branding.appName}
          </h1>
          <p className="text-muted-foreground mt-2 text-sm">
            Sign in with your <code className="bg-muted rounded px-1">@{ALLOWED_EMAIL_DOMAIN}</code>{' '}
            Google account.
          </p>
        </div>

        <Button onClick={signIn} disabled={pending} size="lg" className="w-full">
          {pending ? 'Signing in…' : 'Continue with Google'}
        </Button>

        {error ? (
          <div
            role="alert"
            className="border-destructive bg-ops-red-lighter text-ops-red-dark mt-6 rounded-md border-l-4 px-4 py-3 text-sm"
          >
            {error}
          </div>
        ) : null}

        <p className="text-muted-foreground mt-8 text-center text-xs">
          Access is restricted to current Orono Public Schools staff. If you believe you should have
          access but are blocked, contact a peer evaluator administrator.
        </p>
      </div>
    </main>
  );
}
