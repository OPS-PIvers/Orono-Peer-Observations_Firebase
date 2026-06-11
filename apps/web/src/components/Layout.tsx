import { Suspense } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { AppSidebar, useSidebar } from '@/components/AppSidebar';
import { AppHeader } from '@/components/AppHeader';
import { BrandingProvider } from '@/components/BrandingProvider';
import { GlobalBanner } from '@/components/GlobalBanner';
import { TopLoadingBar } from '@/components/TopLoadingBar';
import { useAuth } from '@/auth/AuthProvider';
import { cn } from '@/lib/utils';
import { ActiveObservationTypesProvider } from '@/observations/ActiveObservationTypesContext';
import { GeminiFeaturesProvider } from '@/hooks/useGeminiFeatures';

export function Layout() {
  const { pcExpanded, togglePc, mobileOpen, openMobile, closeMobile } = useSidebar();
  const { user } = useAuth();
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
      {/* Admin-managed announcement strip — spans the full viewport width
          (above the sidebar) so it reads as app chrome on every page. */}
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

  // One shared `/appSettings/global` listener for the whole shell (Gemini
  // feature flags), instead of each editor consumer opening its own.
  // BrandingProvider applies the admin-configured primary color to the app
  // chrome by writing CSS custom properties on <html> (see index.css).
  const shell = (
    <BrandingProvider>
      <GeminiFeaturesProvider>{inner}</GeminiFeaturesProvider>
    </BrandingProvider>
  );

  // Mount the active-observation listeners once per session. Both plain
  // staff and special-access users may have observations where they're the
  // observed party (dashboard cards, MyRubricPage forms), so this is no
  // longer gated on `hasSpecialAccess` — the dashboard and MyRubricPage read
  // the raw observations straight from this context.
  if (lowerEmail) {
    return (
      <ActiveObservationTypesProvider email={lowerEmail}>{shell}</ActiveObservationTypesProvider>
    );
  }

  return shell;
}
