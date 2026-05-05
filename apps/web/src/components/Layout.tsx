import type { ReactNode } from 'react';
import { AppSidebar, useSidebar } from '@/components/AppSidebar';
import { AppHeader } from '@/components/AppHeader';
import { useAuth } from '@/auth/AuthProvider';
import { cn } from '@/lib/utils';
import { ActiveObservationTypesProvider } from '@/observations/ActiveObservationTypesContext';

export function Layout({ children }: { children: ReactNode }) {
  const { pcExpanded, togglePc, mobileOpen, openMobile, closeMobile } = useSidebar();
  const { user, claims } = useAuth();
  const lowerEmail = user?.email?.toLowerCase() ?? '';

  // App shell: full-width AppHeader on top, sidebar + content below it.
  // The header spans the entire viewport (above the sidebar) so we never
  // leave a dead rectangle in the top-left of the desktop layout.
  const inner = (
    <div className="bg-ops-gray-lightest flex h-svh flex-col overflow-hidden">
      <AppHeader
        pcExpanded={pcExpanded}
        onTogglePc={togglePc}
        onOpenMobile={openMobile}
      />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <AppSidebar
          pcExpanded={pcExpanded}
          mobileOpen={mobileOpen}
          onCloseMobile={closeMobile}
        />
        <div
          className={cn(
            'flex min-w-0 flex-1 flex-col overflow-hidden transition-[margin-left] duration-200',
            pcExpanded ? 'xl:ml-60' : 'xl:ml-14',
          )}
        >
          <main className="flex-1 overflow-y-auto">
            {children}
            <footer className="border-border text-muted-foreground mt-8 border-t px-4 py-4 text-center text-xs">
              Orono Public Schools · Peer Observations
            </footer>
          </main>
        </div>
      </div>
    </div>
  );

  if (!claims.hasSpecialAccess && lowerEmail) {
    return (
      <ActiveObservationTypesProvider email={lowerEmail}>{inner}</ActiveObservationTypesProvider>
    );
  }

  return inner;
}
