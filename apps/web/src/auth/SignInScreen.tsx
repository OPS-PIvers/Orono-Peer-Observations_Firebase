import { useState } from 'react';
import { GoogleAuthProvider, signInWithRedirect } from 'firebase/auth';
import { Navigate } from 'react-router-dom';
import { ALLOWED_EMAIL_DOMAIN } from '@ops/shared';
import { auth } from '@/lib/firebase';
import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/ui/button';

export function SignInScreen() {
  const { status } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // If the user already has a session (e.g., they just came back from
  // signInWithRedirect), bounce them off /sign-in. RoleAwareRedirect at
  // "/" picks the right landing page based on claims. Without this
  // guard, the post-redirect URL stays /sign-in and the user re-clicks
  // Continue with Google → loop.
  if (status === 'signed-in') {
    return <Navigate to="/" replace />;
  }
  // Don't render the sign-in form while AuthProvider is still resolving
  // a possible session (initial mount, or a redirect-result still being
  // processed) — otherwise the user can click Continue again before the
  // redirect-back has finished, kicking off another OAuth round-trip.
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
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ hd: ALLOWED_EMAIL_DOMAIN });
      // Redirect (not popup): Chrome's default Cross-Origin-Opener-Policy
      // breaks Firebase's `signInWithPopup` polling. The popup completes
      // sign-in but the parent never picks up the result. The full-page
      // redirect avoids the issue entirely. AuthProvider calls
      // getRedirectResult on mount to surface the post-redirect user.
      await signInWithRedirect(auth, provider);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sign-in failed. Please try again.';
      setError(message);
      setPending(false);
    }
    // Note: on success, signInWithRedirect navigates away — we never
    // reach the finally clause to reset pending. The page reloads from
    // Google and AuthProvider takes over.
  }

  return (
    <main className="bg-ops-gray-lightest flex min-h-svh items-center justify-center px-4 py-12">
      <div className="border-border bg-background w-full max-w-md rounded-lg border p-8 shadow-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <img
            src="/brand/primary-logo.png"
            alt="Orono Technology"
            className="mb-6 h-auto w-64"
            onError={(e) => {
              // Hide the broken image until logo PNGs are dropped into apps/web/public/brand/
              e.currentTarget.style.display = 'none';
            }}
          />
          <h1 className="font-heading text-ops-blue-dark text-2xl font-semibold">
            Peer Observations
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
