import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { isAdminRole } from '@ops/shared';
import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/ui/button';

/**
 * Top-level shell with the OPS brand top nav, signed-in user menu, and a
 * content slot. Used by all authenticated routes.
 */
export function Layout({ children }: { children: ReactNode }) {
  const { user, claims, signOut } = useAuth();

  return (
    <div className="bg-ops-gray-lightest flex min-h-svh flex-col">
      <header className="bg-primary text-primary-foreground">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3">
          <Link to="/" className="flex items-center gap-3">
            <img
              src="/brand/primary-logo.png"
              alt="Orono Technology"
              className="h-10 w-auto"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
              }}
            />
            <span className="font-heading text-lg font-semibold">Peer Observations</span>
          </Link>

          {user ? (
            <div className="flex items-center gap-3">
              {isAdminRole(claims.role) ? (
                <Link
                  to="/admin"
                  className="text-primary-foreground hover:bg-ops-blue-light rounded-md px-3 py-1.5 text-sm font-medium"
                >
                  Admin
                </Link>
              ) : null}
              <div className="hidden text-sm sm:block">
                <div>{user.displayName ?? user.email}</div>
                {claims.role ? (
                  <div className="text-ops-blue-lighter text-xs">{claims.role}</div>
                ) : null}
              </div>
              <Button
                variant="outline"
                size="sm"
                className="text-primary-foreground hover:bg-ops-blue-light bg-transparent"
                onClick={() => void signOut()}
              >
                Sign out
              </Button>
            </div>
          ) : null}
        </div>
      </header>

      <main className="flex-1">
        <div className="mx-auto max-w-7xl px-4 py-8">{children}</div>
      </main>

      <footer className="border-border bg-background text-muted-foreground border-t py-4 text-center text-xs">
        Orono Public Schools · Peer Observations
      </footer>
    </div>
  );
}
