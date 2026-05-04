import { useState } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/ui/button';

export function Unauthorized() {
  const { user, signOut, refreshClaims } = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  const [refreshState, setRefreshState] = useState<'idle' | 'done' | 'error'>('idle');

  async function handleRefresh() {
    setRefreshing(true);
    setRefreshState('idle');
    try {
      await refreshClaims();
      setRefreshState('done');
    } catch {
      setRefreshState('error');
    } finally {
      setRefreshing(false);
    }
  }

  const buttonLabel = refreshing
    ? 'Refreshing…'
    : refreshState === 'error'
      ? 'Refresh failed — try again'
      : refreshState === 'done'
        ? 'Access refreshed — try again'
        : 'Refresh access';

  const announcement = refreshing
    ? 'Refreshing access…'
    : refreshState === 'error'
      ? 'Refresh failed. Please try again.'
      : refreshState === 'done'
        ? 'Access refreshed. Try navigating back to the page.'
        : '';

  return (
    <section className="bg-background border-border mx-auto mt-12 max-w-xl rounded-lg border p-8 text-center shadow-sm">
      <h1 className="text-ops-red-dark mb-3 text-2xl font-bold">Access denied</h1>
      <p className="text-muted-foreground mb-6">
        Your account ({user?.email}) is signed in, but doesn&apos;t have permission to view this
        page. If you believe this is wrong, contact a peer evaluator administrator.
      </p>
      {/* Screen-reader live region for async state changes */}
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </span>
      <div className="flex flex-wrap justify-center gap-3">
        <Button onClick={() => void signOut()} variant="outline">
          Sign out
        </Button>
        <Button
          onClick={() => void handleRefresh()}
          variant="outline"
          disabled={refreshing}
          title="Re-check your access level — useful after an admin updates your permissions"
        >
          {buttonLabel}
        </Button>
      </div>
    </section>
  );
}
