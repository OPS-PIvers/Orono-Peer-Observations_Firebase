import { useAuth } from '@/auth/AuthProvider';

/**
 * Phase 1 placeholder for staff (Teacher / specialist) — they see their own
 * rubric here. Phase 4 swaps this for the actual rubric viewer.
 */
export function MyRubric() {
  const { user, claims } = useAuth();
  return (
    <section>
      <h1 className="mb-2 text-3xl font-bold">My Rubric</h1>
      <p className="text-muted-foreground mb-8 text-base">
        Hi, {user?.displayName ?? user?.email}. Your role:{' '}
        <strong>{claims.role ?? 'Unknown'}</strong>.
      </p>
      <div className="border-primary bg-accent text-accent-foreground rounded-md border-l-4 p-4">
        <p className="text-sm">
          <strong>Phase 1 placeholder.</strong> Real rubric viewer ships in Phase 4 once Firestore
          rubric data and the role/year settings matrix exist.
        </p>
      </div>
    </section>
  );
}
