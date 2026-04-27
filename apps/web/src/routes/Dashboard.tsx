import { useAuth } from '@/auth/AuthProvider';

/**
 * Phase 1 placeholder for the special-access (Admin / Peer Evaluator / Full
 * Access) landing page. Phase 4 swaps this for the filter / observation list
 * UI; Phase 3 lays an /admin section in alongside.
 */
export function Dashboard() {
  const { user, claims } = useAuth();
  return (
    <section>
      <h1 className="mb-2 text-3xl font-bold">Welcome, {user?.displayName ?? user?.email}</h1>
      <p className="text-muted-foreground mb-8 text-base">
        Role: <strong>{claims.role ?? 'Unknown'}</strong>
        {claims.hasSpecialAccess ? ' (special access)' : ''}
      </p>
      <div className="border-primary bg-accent text-accent-foreground rounded-md border-l-4 p-4">
        <p className="text-sm">
          <strong>Phase 1 placeholder.</strong> Filter UI + observation list ships in Phase 4; admin
          section ships in Phase 3.
        </p>
      </div>
    </section>
  );
}
