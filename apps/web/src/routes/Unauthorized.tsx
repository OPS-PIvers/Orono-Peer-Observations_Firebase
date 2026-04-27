import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/ui/button';

export function Unauthorized() {
  const { user, signOut } = useAuth();
  return (
    <section className="bg-background border-border mx-auto mt-12 max-w-xl rounded-lg border p-8 text-center shadow-sm">
      <h1 className="text-ops-red-dark mb-3 text-2xl font-bold">Access denied</h1>
      <p className="text-muted-foreground mb-6">
        Your account ({user?.email}) is signed in, but doesn&apos;t have permission to view this
        page. If you believe this is wrong, contact a peer evaluator administrator.
      </p>
      <Button onClick={() => void signOut()} variant="outline">
        Sign out
      </Button>
    </section>
  );
}
