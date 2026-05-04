import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { SIDEBAR_TOGGLE_EVENT } from '@/hooks/useSidebarWidth';
import {
  ArrowLeft,
  Building2,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Eye,
  FileText,
  LayoutGrid,
  LogOut,
  Menu,
  Settings,
  User,
  Users,
  X,
} from 'lucide-react';
import { SPECIAL_ROLES } from '@ops/shared';
import { useAuth } from '@/auth/AuthProvider';
import { useEffectiveClaims } from '@/dev/DevModeContext';
import { useActiveObservationTypes } from '@/observations/ActiveObservationTypesContext';
import { cn } from '@/lib/utils';
import { ADMIN_NAV } from '@/admin/adminNav';

// ─── Types ───────────────────────────────────────────────────────────────────

interface NavSubItem {
  label: string;
  href: string;
}

interface NavItem {
  icon: React.ElementType;
  label: string;
  href?: string;
  action?: () => void;
  locked?: boolean;
  children?: NavSubItem[];
}

interface NavConfig {
  main: NavItem[];
  meta: NavItem[];
}

// ─── useSidebar hook ─────────────────────────────────────────────────────────

const STORAGE_KEY = 'ops:sidebar:expanded';

export function useSidebar() {
  const [pcExpanded, setPcExpanded] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) !== 'false';
    } catch {
      return true;
    }
  });
  const [mobileOpen, setMobileOpen] = useState(false);

  const togglePc = useCallback(() => {
    setPcExpanded((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        // ignore storage errors
      }
      window.dispatchEvent(new CustomEvent(SIDEBAR_TOGGLE_EVENT, { detail: { expanded: next } }));
      return next;
    });
  }, []);

  const openMobile = useCallback(() => setMobileOpen(true), []);
  const closeMobile = useCallback(() => setMobileOpen(false), []);

  return { pcExpanded, togglePc, mobileOpen, openMobile, closeMobile };
}

// ─── Nav item builder ────────────────────────────────────────────────────────

const OBS_CHILDREN: NavSubItem[] = [
  { label: 'Active drafts', href: '/observations?status=draft' },
  { label: 'Finalized', href: '/observations?status=finalized' },
  { label: 'All observations', href: '/observations' },
];

interface NavFlags {
  hasWorkProduct: boolean;
  hasInstructionalRound: boolean;
  isAdmin: boolean;
}

function buildNavItems(
  role: string | null,
  onSignOut: () => void,
  flags: NavFlags = { hasWorkProduct: false, hasInstructionalRound: false, isAdmin: false },
): NavConfig {
  const metaItems: NavItem[] = [
    { icon: User, label: 'Profile', href: '/profile' },
    { icon: LogOut, label: 'Sign out', action: onSignOut },
  ];

  // Role-specific layouts come first — Administrators are also `isAdmin`,
  // so checking `role` ahead of `flags.isAdmin` is what wires up their
  // building-scoped /my-staff link.
  if (role === SPECIAL_ROLES.administrator) {
    const main: NavItem[] = [
      { icon: LayoutGrid, label: 'My Rubric', href: '/my-rubric' },
      { icon: Building2, label: 'My Staff', href: '/my-staff' },
      { icon: ClipboardList, label: 'Observations', children: OBS_CHILDREN },
    ];
    if (flags.isAdmin) {
      main.push({ icon: Settings, label: 'Admin Console', href: '/admin' });
    }
    return { main, meta: metaItems };
  }

  if (role === SPECIAL_ROLES.peerEvaluator) {
    return {
      main: [
        { icon: LayoutGrid, label: 'My Rubric', href: '/my-rubric' },
        { icon: Users, label: 'Staff', href: '/staff' },
        { icon: ClipboardList, label: 'Observations', children: OBS_CHILDREN },
      ],
      meta: metaItems,
    };
  }

  // Full Access role, or a non-special role with `hasAdminAccess: true`
  // (the dev-admin escape hatch). No /staff sidebar link — they can
  // reach the directory via Admin Console → Staff.
  if (flags.isAdmin) {
    return {
      main: [
        { icon: LayoutGrid, label: 'My Rubric', href: '/my-rubric' },
        { icon: ClipboardList, label: 'Observations', children: OBS_CHILDREN },
        { icon: Settings, label: 'Admin Console', href: '/admin' },
      ],
      meta: metaItems,
    };
  }

  // Staff (no special access)
  return {
    main: [
      { icon: LayoutGrid, label: 'My Rubric', href: '/my-rubric' },
      {
        icon: ClipboardList,
        label: 'Observations',
        children: [{ label: 'View finalized observations', href: '/my-rubric' }],
      },
      {
        icon: FileText,
        label: 'Work Product',
        ...(flags.hasWorkProduct ? { href: '/my-rubric' } : { locked: true }),
      },
      {
        icon: Eye,
        label: 'Instructional Round',
        ...(flags.hasInstructionalRound ? { href: '/my-rubric' } : { locked: true }),
      },
    ],
    meta: metaItems,
  };
}

function isActivePath(href: string, pathname: string): boolean {
  const hrefPath = href.split('?')[0] ?? href;
  if (hrefPath === '/') return pathname === '/';
  return pathname === hrefPath || pathname.startsWith(hrefPath + '/');
}

// ─── AppSidebar component ────────────────────────────────────────────────────

interface AppSidebarProps {
  pcExpanded: boolean;
  onTogglePc: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

export function AppSidebar({ pcExpanded, onTogglePc, mobileOpen, onCloseMobile }: AppSidebarProps) {
  const { user, signOut } = useAuth();
  const claims = useEffectiveClaims();
  const { hasWorkProduct, hasInstructionalRound } = useActiveObservationTypes();
  const location = useLocation();
  const navigate = useNavigate();
  const inAdmin = location.pathname.startsWith('/admin');
  // Explicit per-section open/close overrides. If a label has no entry,
  // fall back to "open if a child route is currently active" — that
  // auto-expands Observations when you're sitting on /observations.
  // Once the user manually toggles, their choice sticks (so they can
  // collapse the section even while on a child route).
  const [explicitOpen, setExplicitOpen] = useState<Map<string, boolean>>(new Map());

  const onCloseMobileRef = useRef(onCloseMobile);
  useLayoutEffect(() => {
    onCloseMobileRef.current = onCloseMobile;
  });

  useEffect(() => {
    onCloseMobileRef.current();
  }, [location.pathname]);

  const handleSignOut = useCallback(() => void signOut(), [signOut]);
  const navConfig = buildNavItems(claims.role, handleSignOut, {
    hasWorkProduct,
    hasInstructionalRound,
    isAdmin: claims.isAdmin,
  });
  const showLabels = pcExpanded || mobileOpen;

  function isSectionVisible(item: NavItem): boolean {
    const override = explicitOpen.get(item.label);
    if (override !== undefined) return override;
    return item.children?.some((c) => isActivePath(c.href, location.pathname)) ?? false;
  }

  function toggleSection(label: string) {
    const item = navConfig.main.find((i) => i.label === label);
    const currentlyVisible = item ? isSectionVisible(item) : false;
    setExplicitOpen((prev) => {
      const next = new Map(prev);
      next.set(label, !currentlyVisible);
      return next;
    });
  }

  return (
    <>
      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 xl:hidden"
          onClick={onCloseMobile}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <nav
        className={cn(
          'bg-ops-blue-dark fixed inset-y-0 left-0 z-50 flex flex-col text-white',
          'w-60 transition-all duration-200',
          mobileOpen ? 'translate-x-0' : '-translate-x-full xl:translate-x-0',
          pcExpanded ? 'xl:w-60' : 'xl:w-14',
        )}
        aria-label="Main navigation"
      >
        {/* Header */}
        <div className="flex h-[52px] shrink-0 items-center border-b border-white/10 px-2">
          <button
            type="button"
            onClick={onTogglePc}
            className="hidden h-8 w-8 items-center justify-center rounded-md text-white hover:bg-white/10 xl:inline-flex"
            aria-label={pcExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
          >
            <Menu className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={onCloseMobile}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-white hover:bg-white/10 xl:hidden"
            aria-label="Close navigation"
          >
            <X className="h-5 w-5" />
          </button>
          {showLabels && (
            <>
              <img
                src="/brand/torch-icon.png"
                alt=""
                className="ml-2 h-8 w-8 shrink-0 object-contain"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                }}
              />
              <span className="font-heading ml-2 truncate text-sm font-semibold text-white">
                Peer Observations
              </span>
            </>
          )}
        </div>

        {/* User identity strip */}
        {showLabels && user && (
          <div className="shrink-0 border-b border-white/10 px-3 py-2.5">
            <div className="truncate text-sm font-medium text-white">
              {user.displayName ?? user.email}
            </div>
            {claims.role ? (
              <div className="text-ops-blue-lighter truncate text-xs">{claims.role}</div>
            ) : null}
          </div>
        )}

        {/* Sliding viewport: main nav ⇄ admin sub-nav. Driven by the
            current route — /admin/* shifts the inner track left to reveal
            the admin panel. Same translate-x + duration-200 idiom used by
            the mobile sidebar above. */}
        <div className="relative flex-1 overflow-hidden">
          <div
            className={cn(
              'flex h-full w-[200%] transition-transform duration-200 ease-out',
              inAdmin && '-translate-x-1/2',
            )}
          >
            {/* Main panel */}
            <div
              className="w-1/2 shrink-0 overflow-y-auto py-2"
              aria-hidden={inAdmin}
              inert={inAdmin}
            >
              <ul className={cn('space-y-0.5', showLabels ? 'px-2' : 'px-1')}>
                {navConfig.main.map((item) => (
                  <li key={item.label}>
                    <NavEntry
                      item={item}
                      showLabels={showLabels}
                      location={location}
                      sectionOpen={isSectionVisible(item)}
                      onToggleSection={toggleSection}
                    />
                  </li>
                ))}
              </ul>
            </div>

            {/* Admin panel */}
            <div
              className="w-1/2 shrink-0 overflow-y-auto py-2"
              aria-hidden={!inAdmin}
              inert={!inAdmin}
              aria-label="Admin navigation"
            >
              <button
                type="button"
                onClick={() => void navigate('/my-rubric')}
                className={cn(
                  'mb-1 flex w-full items-center rounded-md py-2 text-sm transition-colors',
                  'text-white/70 hover:bg-white/10 hover:text-white',
                  showLabels ? 'gap-2.5 px-2' : 'justify-center px-0',
                )}
                aria-label="Back to main menu"
              >
                <ArrowLeft className="h-5 w-5 shrink-0" />
                {showLabels && <span>Back</span>}
              </button>
              <ul className={cn('space-y-0.5', showLabels ? 'px-2' : 'px-1')}>
                {ADMIN_NAV.map(({ to, label, icon: Icon }) => (
                  <li key={to}>
                    <NavLink
                      to={to}
                      end
                      className={({ isActive }) =>
                        cn(
                          'flex w-full items-center rounded-md py-2 text-sm transition-colors',
                          'text-white/70 hover:bg-white/10 hover:text-white',
                          showLabels ? 'gap-2.5 px-2' : 'justify-center px-0',
                          isActive && 'bg-white/15 text-white',
                        )
                      }
                      title={label}
                    >
                      <Icon className="h-5 w-5 shrink-0" />
                      {showLabels && <span>{label}</span>}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        {/* Footer meta items */}
        <div className="shrink-0 border-t border-white/10 py-2">
          <ul className={cn('space-y-0.5', showLabels ? 'px-2' : 'px-1')}>
            {navConfig.meta.map((item) => (
              <li key={item.label}>
                <NavEntry
                  item={item}
                  showLabels={showLabels}
                  location={location}
                  sectionOpen={false}
                  onToggleSection={toggleSection}
                />
              </li>
            ))}
          </ul>
        </div>
      </nav>
    </>
  );
}

// ─── NavEntry ────────────────────────────────────────────────────────────────

interface NavEntryProps {
  item: NavItem;
  showLabels: boolean;
  location: ReturnType<typeof useLocation>;
  sectionOpen: boolean;
  onToggleSection: (label: string) => void;
}

function NavEntry({ item, showLabels, location, sectionOpen, onToggleSection }: NavEntryProps) {
  const isActive = item.href ? isActivePath(item.href, location.pathname) : false;

  const baseItemCls = cn(
    'flex w-full items-center rounded-md py-2 text-sm transition-colors',
    'text-white/70 hover:bg-white/10 hover:text-white',
    showLabels ? 'gap-2.5 px-2' : 'justify-center px-0',
  );

  if (item.locked) {
    return (
      <div
        className={cn(
          'flex items-center rounded-md py-2 text-sm',
          'pointer-events-none cursor-not-allowed text-white/30',
          showLabels ? 'gap-2.5 px-2' : 'justify-center px-0',
        )}
        title={item.label}
      >
        <item.icon className="h-5 w-5 shrink-0" aria-hidden="true" />
        {showLabels && (
          <span>
            {item.label} <span className="text-[11px]">(not started)</span>
          </span>
        )}
      </div>
    );
  }

  if (item.children) {
    return (
      <div>
        <button
          type="button"
          onClick={() => onToggleSection(item.label)}
          aria-expanded={sectionOpen}
          className={cn(baseItemCls, sectionOpen && 'text-white')}
        >
          <item.icon className="h-5 w-5 shrink-0" />
          {showLabels && (
            <>
              <span className="flex-1 text-left">{item.label}</span>
              {sectionOpen ? (
                <ChevronDown className="h-4 w-4 shrink-0" />
              ) : (
                <ChevronRight className="h-4 w-4 shrink-0" />
              )}
            </>
          )}
        </button>
        {showLabels && sectionOpen && (
          <ul className="mt-0.5 ml-7 border-l border-white/10">
            {item.children.map((child) => {
              const childActive = isActivePath(child.href, location.pathname);
              return (
                <li key={child.href}>
                  <Link
                    to={child.href}
                    className={cn(
                      'block rounded-md py-1.5 pr-2 pl-3 text-sm transition-colors',
                      'text-white/70 hover:bg-white/10 hover:text-white',
                      childActive && 'bg-white/15 text-white',
                    )}
                  >
                    {child.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );
  }

  if (item.action) {
    return (
      <button type="button" onClick={item.action} className={baseItemCls}>
        <item.icon className="h-5 w-5 shrink-0" />
        {showLabels && <span>{item.label}</span>}
      </button>
    );
  }

  if (!item.href) return null;

  return (
    <Link to={item.href} className={cn(baseItemCls, isActive && 'bg-white/15 text-white')}>
      <item.icon className="h-5 w-5 shrink-0" />
      {showLabels && <span>{item.label}</span>}
    </Link>
  );
}
