import type { ReactNode } from 'react';
import { Menu } from 'lucide-react';
import { AppSidebar, useSidebar } from '@/components/AppSidebar';
import { useAuth } from '@/auth/AuthProvider';
import { cn } from '@/lib/utils';
import { ActiveObservationTypesProvider } from '@/observations/ActiveObservationTypesContext';

function MobileTopBar({ onOpenSidebar }: { onOpenSidebar: () => void }) {
  return (
    <div className="bg-ops-blue-dark flex h-[52px] shrink-0 items-center gap-3 px-4 xl:hidden">
      <button
        type="button"
        onClick={onOpenSidebar}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-white hover:bg-white/10"
        aria-label="Open navigation"
      >
        <Menu className="h-5 w-5" />
      </button>
      <img
        src="/brand/torch-icon.png"
        alt=""
        className="h-8 w-8 object-contain"
        onError={(e) => {
          e.currentTarget.style.display = 'none';
        }}
      />
      <span className="font-heading text-sm font-semibold text-white">Peer Observations</span>
    </div>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const { pcExpanded, togglePc, mobileOpen, openMobile, closeMobile } = useSidebar();
  const { user, claims } = useAuth();
  const lowerEmail = user?.email?.toLowerCase() ?? '';

  const inner = (
    <div className="bg-ops-gray-lightest flex h-svh overflow-hidden">
      <AppSidebar
        pcExpanded={pcExpanded}
        onTogglePc={togglePc}
        mobileOpen={mobileOpen}
        onCloseMobile={closeMobile}
      />
      <div
        className={cn(
          'flex min-w-0 flex-1 flex-col overflow-hidden transition-[margin-left] duration-200',
          pcExpanded ? 'xl:ml-60' : 'xl:ml-14',
        )}
      >
        <MobileTopBar onOpenSidebar={openMobile} />
        {/* `<main>` fills the area between the fixed sidebar and the
            viewport's right edge — no `max-w-7xl mx-auto` wrapper here.
            That centering wrapper now lives inside `PageHeader` (around
            its body) so the dark header strip can extend edge-to-edge of
            `<main>` without negative-margin tricks. Pages that don't use
            PageHeader supply their own width-constrained wrapper. */}
        <main className="flex-1 overflow-y-auto">
          {children}
          <footer className="border-border text-muted-foreground mt-8 border-t px-4 py-4 text-center text-xs">
            Orono Public Schools · Peer Observations
          </footer>
        </main>
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
