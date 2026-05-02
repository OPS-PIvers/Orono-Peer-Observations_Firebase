import type { ReactNode } from 'react';
import { Menu } from 'lucide-react';
import { AppSidebar, useSidebar } from '@/components/AppSidebar';
import { cn } from '@/lib/utils';

function MobileTopBar({ onOpenSidebar }: { onOpenSidebar: () => void }) {
  return (
    <div className="flex h-[52px] shrink-0 items-center gap-3 bg-ops-blue-dark px-4 xl:hidden">
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
  return (
    <div className="flex h-svh overflow-hidden bg-ops-gray-lightest">
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
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-7xl px-4 py-6 md:px-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
