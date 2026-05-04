import type { ReactNode } from 'react';

/**
 * Generic "this admin page is coming in a later phase" placeholder. Used
 * for tabs that exist in AdminLayout's nav but haven't been built yet
 * (Phase 3 is incremental).
 */
export function AdminPlaceholder({
  title,
  phase,
  children,
}: {
  title: string;
  phase: string;
  children?: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 md:px-6">
      <h1 className="mb-2 text-3xl font-bold">{title}</h1>
      <div className="border-primary bg-accent text-accent-foreground rounded-md border-l-4 p-4">
        <p className="text-sm">
          <strong>Coming in {phase}.</strong>{' '}
          {children ??
            'This admin page is not yet implemented. The data model and security rules already support it; the UI lands in a follow-up commit.'}
        </p>
      </div>
    </div>
  );
}
