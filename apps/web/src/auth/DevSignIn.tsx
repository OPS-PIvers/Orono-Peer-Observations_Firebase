import { useState } from 'react';
import { signInWithCustomToken } from 'firebase/auth';
import { Navigate, useNavigate } from 'react-router-dom';
import { auth } from '@/lib/firebase';
import { Button } from '@/components/ui/button';

const DEV_AUTH_SERVER_URL =
  (import.meta.env['VITE_DEV_AUTH_SERVER'] as string | undefined) ?? 'http://127.0.0.1:8787';

const QUICK_USERS = [{ email: 'paul.ivers@orono.k12.mn.us', label: 'Paul Ivers (admin)' }];

/**
 * Local-dev sign-in helper. Signs in via a custom token minted by the
 * sibling `scripts/dev-auth-server.mjs` (which uses Application Default
 * Credentials — Paul's gcloud auth — to call the Admin SDK).
 *
 * Lives behind an `import.meta.env.MODE === 'development'` check in
 * App.tsx, so it tree-shakes out of `pnpm build` and never reaches the
 * dev/prod hosting channels. Even if a build accidentally included this
 * page, the dev-auth-server isn't deployed anywhere — the page would
 * just fail to fetch a token.
 */
export function DevSignIn() {
  const navigate = useNavigate();
  const [email, setEmail] = useState(QUICK_USERS[0]?.email ?? '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (import.meta.env.MODE !== 'development') {
    return <Navigate to="/sign-in" replace />;
  }

  async function signInAs(targetEmail: string) {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`${DEV_AUTH_SERVER_URL}/mint`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: targetEmail }),
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`mint failed (${String(response.status)}): ${text}`);
      }
      const data = (await response.json()) as { customToken: string };
      await signInWithCustomToken(auth, data.customToken);
      void navigate('/');
    } catch (err) {
      setError(
        err instanceof Error
          ? `${err.message} — is the dev-auth-server running? (\`pnpm dev:auth-server\`)`
          : 'Sign-in failed',
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="bg-ops-gray-lightest flex min-h-svh items-center justify-center px-4 py-12">
      <div className="border-border bg-background w-full max-w-md space-y-5 rounded-lg border p-8 shadow-sm">
        <header className="text-center">
          <p className="text-ops-red font-mono text-xs tracking-widest uppercase">DEV MODE</p>
          <h1 className="font-heading text-ops-blue-dark mt-2 text-2xl font-semibold">
            Local sign-in
          </h1>
          <p className="text-muted-foreground mt-2 text-sm">
            Skips Google OAuth by signing in with a custom token minted by{' '}
            <code className="bg-muted rounded px-1">dev-auth-server.mjs</code>. Live Firestore; real
            audit log entries.
          </p>
        </header>

        <div className="space-y-2">
          <p className="text-muted-foreground text-xs uppercase">Quick users</p>
          {QUICK_USERS.map((u) => (
            <Button
              key={u.email}
              onClick={() => void signInAs(u.email)}
              disabled={pending}
              className="w-full"
              variant="outline"
            >
              {u.label}
            </Button>
          ))}
        </div>

        <div className="space-y-2 border-t pt-4">
          <p className="text-muted-foreground text-xs uppercase">Other email</p>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="border-input bg-background h-11 w-full rounded-md border px-3 text-sm"
            placeholder="email@orono.k12.mn.us"
          />
          <Button
            onClick={() => void signInAs(email)}
            disabled={pending || !email}
            className="w-full"
          >
            {pending ? 'Signing in…' : 'Sign in'}
          </Button>
        </div>

        {error ? (
          <div className="border-destructive bg-ops-red-lighter text-ops-red-dark rounded-md border-l-4 px-3 py-2 text-sm whitespace-pre-line">
            {error}
          </div>
        ) : null}
      </div>
    </main>
  );
}
