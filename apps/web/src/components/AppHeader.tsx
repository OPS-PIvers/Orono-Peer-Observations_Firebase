import { Menu } from 'lucide-react';
import { DevModeBar } from '@/dev/DevModeBar';

export interface AppHeaderProps {
  /** True when the desktop sidebar is in expanded (240px) mode. Used only
   * for the toggle's aria-label; the click handler doesn't care. */
  pcExpanded: boolean;
  /** Toggle the desktop sidebar between rail (56px) and expanded (240px). */
  onTogglePc: () => void;
  /** Open the off-canvas sidebar drawer on `<xl`. */
  onOpenMobile: () => void;
}

/**
 * Persistent app chrome at the top of every page. Replaces the previous
 * `<MobileTopBar>` (which only showed on `<xl`) so desktop and mobile
 * share the same brand strip and navigation affordance.
 *
 * The single left-side button doubles as the hamburger (off-canvas open)
 * on `<xl` and the rail toggle on `xl+` — same icon, different click
 * behavior, so the chrome doesn't shift when the breakpoint changes.
 *
 * The right-side slot hosts `<DevModeBar>` for dev users (rendered
 * inline, not floating). Future profile/avatar UI lives here too.
 */
export function AppHeader({ pcExpanded, onTogglePc, onOpenMobile }: AppHeaderProps) {
  return (
    <header className="bg-ops-blue-dark relative z-50 flex h-[52px] shrink-0 items-center gap-3 px-3 text-white shadow-[0_1px_0_rgba(0,0,0,0.15)]">
      {/* Mobile hamburger — opens the off-canvas drawer. */}
      <button
        type="button"
        onClick={onOpenMobile}
        className="inline-flex h-9 w-9 items-center justify-center rounded-md text-white hover:bg-white/10 xl:hidden"
        aria-label="Open navigation"
      >
        <Menu className="h-5 w-5" />
      </button>
      {/* Desktop rail toggle — same icon, different action. */}
      <button
        type="button"
        onClick={onTogglePc}
        className="hidden h-9 w-9 items-center justify-center rounded-md text-white hover:bg-white/10 xl:inline-flex"
        aria-label={pcExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
      >
        <Menu className="h-5 w-5" />
      </button>

      <img
        src="/brand/torch-icon.png"
        alt=""
        className="h-8 w-8 shrink-0 object-contain"
        onError={(e) => {
          e.currentTarget.style.display = 'none';
        }}
      />
      <span className="font-heading text-base font-semibold tracking-wide select-none">
        Peer Observations
      </span>

      <div className="ml-auto flex items-center gap-2">
        <DevModeBar />
      </div>
    </header>
  );
}
