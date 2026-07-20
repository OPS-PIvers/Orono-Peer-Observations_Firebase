import { Suspense } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { AppSidebar, useSidebar } from '@/components/AppSidebar';
import { AppHeader } from '@/components/AppHeader';
import { GlobalBanner } from '@/components/GlobalBanner';
import { TopLoadingBar } from '@/components/TopLoadingBar';
import { useAuth } from '@/auth/AuthProvider';
import { cn } from '@/lib/utils';
import { ActiveObservationTypesProvider } from '@/observations/ActiveObservationTypesContext';

export function Layout() {
  const { pcExpanded, togglePc, mobileOpen, openMobile, closeMobile } = useSidebar();
  const { user, claims } = useAuth();
  const lowerEmail = user?.email?.toLowerCase() ?? '';
  const { pathname } = useLocation();
  // Hide footer on the observation editor — its sticky script drawer
  // owns the bottom of the viewport and a footer above it reads as
  // misplaced chrome.
  const isEditorRoute = pathname.startsWith('/observations/') && pathname !== '/observations/new';

  // App shell: full-width AppHeader on top, sidebar + content below it.
  // The header spans the entire viewport (above the sidebar) so we never
  // leave a dead rectangle in the top-left of the desktop layout.
  //
  // The Suspense boundary lives INSIDE the shell so when a lazy child
  // route's chunk is still loading, only the main content area shows the
  // fallback (a thin top progress bar). Combined with React Router v7's
  // default startTransition, the previous page stays visible while the
  // new chunk arrives.
  const inner = (
    <div className="bg-ops-gray-lightest flex h-svh flex-col overflow-hidden">
      <AppHeader pcExpanded={pcExpanded} onTogglePc={togglePc} onOpenMobile={openMobile} />
      <GlobalBanner />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <AppSidebar pcExpanded={pcExpanded} mobileOpen={mobileOpen} onCloseMobile={closeMobile} />
        <div
          className={cn(
            'flex min-w-0 flex-1 flex-col overflow-hidden transition-[margin-left] duration-200',
            pcExpanded ? 'xl:ml-60' : 'xl:ml-14',
          )}
        >
          <main className="relative flex-1 overflow-y-auto">
            <Suspense fallback={<TopLoadingBar />}>
              <Outlet />
            </Suspense>
            {!isEditorRoute ? (
              <footer className="border-border text-muted-foreground mt-8 border-t px-4 py-4 text-center text-xs">
                Orono Public Schools · Peer Observations
              </footer>
            ) : null}
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
