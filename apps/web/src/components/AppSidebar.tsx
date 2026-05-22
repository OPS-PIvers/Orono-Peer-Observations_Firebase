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
  Settings,
  Sparkles,
  User,
  Users,
} from 'lucide-react';
import {
  COLLECTIONS,
  SPECIAL_ROLES,
  staffMatchesAutoEnable,
  type ModuleDoc,
  type Role,
  type Rubric,
  type Staff,
} from '@ops/shared';
import { useAuth } from '@/auth/AuthProvider';
import { useEffectiveClaims } from '@/dev/DevModeContext';
import { useActiveObservationTypes } from '@/observations/ActiveObservationTypesContext';
import { useFirestoreCollection } from '@/hooks/useFirestoreCollection';
import { useFirestoreDoc } from '@/hooks/useFirestoreDoc';
import { moduleIconComponent } from '@/modules/moduleIcons';
import { prefetch as prefetchRoute, PREFETCH_BY_PATH } from '@/lazyRoutes';
import { cn } from '@/lib/utils';
import { ADMIN_NAV_SECTIONS } from '@/admin/adminNav';

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
  { label: 'In-progress', href: '/observations?status=draft' },
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
  rubricDomains: NavSubItem[] = [],
): NavConfig {
  const metaItems: NavItem[] = [
    { icon: User, label: 'Profile', href: '/profile' },
    { icon: LogOut, label: 'Sign out', action: onSignOut },
  ];

  // "My Rubric" entry: when we have rubric domains loaded, expose them as
  // children so users can jump to a specific domain. Until then, render as
  // a plain link so the sidebar still works while data loads.
  const myRubricItem: NavItem =
    rubricDomains.length > 0
      ? { icon: LayoutGrid, label: 'My Rubric', href: '/my-rubric', children: rubricDomains }
      : { icon: LayoutGrid, label: 'My Rubric', href: '/my-rubric' };

  // Role-specific layouts come first — Administrators are also `isAdmin`,
  // so checking `role` ahead of `flags.isAdmin` is what wires up their
  // building-scoped /my-staff link.
  const dashboardItem: NavItem = { icon: Sparkles, label: 'My Dashboard', href: '/dashboard' };

  if (role === SPECIAL_ROLES.administrator) {
    const main: NavItem[] = [
      dashboardItem,
      myRubricItem,
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
        dashboardItem,
        myRubricItem,
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
        dashboardItem,
        myRubricItem,
        { icon: ClipboardList, label: 'Observations', children: OBS_CHILDREN },
        { icon: Settings, label: 'Admin Console', href: '/admin' },
      ],
      meta: metaItems,
    };
  }

  // Staff (no special access)
  return {
    main: [
      dashboardItem,
      myRubricItem,
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
  // Strip both query and hash so `/my-rubric#domain-1` matches when the
  // user is on `/my-rubric` (used by section-visibility logic to decide
  // whether to auto-open a parent group).
  const stripped = href.split('?')[0] ?? href;
  const hrefPath = stripped.split('#')[0] ?? stripped;
  if (hrefPath === '/') return pathname === '/';
  return pathname === hrefPath || pathname.startsWith(hrefPath + '/');
}

function isExactChildActive(
  href: string,
  location: { pathname: string; hash: string; search: string },
): boolean {
  const [pathAndQuery, hrefHash] = href.split('#');
  const [hrefPath, hrefQuery] = (pathAndQuery ?? href).split('?');
  const path = hrefPath ?? href;
  const pathMatches = location.pathname === path || location.pathname.startsWith(path + '/');
  if (!pathMatches) return false;
  // Hash-link children (e.g. /my-rubric#domain-1) are active only when the
  // URL hash matches — otherwise all four domain entries would highlight.
  if (hrefHash) return location.hash === `#${hrefHash}`;
  // Query-discriminated children (e.g. /observations?status=draft vs. plain
  // /observations) must match the current query exactly, so the "All
  // observations" link doesn't co-highlight with the filtered ones.
  const hrefSearch = new URLSearchParams(hrefQuery ?? '').toString();
  const locSearch = new URLSearchParams(location.search).toString();
  return hrefSearch === locSearch;
}

/**
 * Hover/focus/touch handlers that kick off the lazy-route chunk for the
 * given href before the user clicks. Vite caches the dynamic-import
 * promise, so calling these multiple times costs nothing.
 *
 * Returns an empty object when no route matches the href (e.g. external
 * links, hash-only links, action items) so callers can spread the result
 * unconditionally.
 */
function prefetchHandlersFor(href: string | undefined) {
  if (!href) return {};
  const path = (href.split('#')[0] ?? '').split('?')[0] ?? '';
  const name = PREFETCH_BY_PATH[path];
  if (!name) return {};
  const fire = () => prefetchRoute(name);
  return { onMouseEnter: fire, onFocus: fire, onTouchStart: fire };
}

// ─── AppSidebar component ────────────────────────────────────────────────────

interface AppSidebarProps {
  pcExpanded: boolean;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

export function AppSidebar({ pcExpanded, mobileOpen, onCloseMobile }: AppSidebarProps) {
  const { user, signOut } = useAuth();
  const claims = useEffectiveClaims();
  const { hasWorkProduct, hasInstructionalRound } = useActiveObservationTypes();
  const location = useLocation();
  const navigate = useNavigate();
  const inAdmin = location.pathname.startsWith('/admin');

  // Resolve the user's rubric so we can surface its domains as sub-items
  // under "My Rubric". Mirrors the role → rubric chain used by MyRubricPage.
  const { data: roles } = useFirestoreCollection<Role>(COLLECTIONS.roles);
  const { data: rubrics } = useFirestoreCollection<Rubric>(COLLECTIONS.rubrics);

  const emailLower = user?.email?.toLowerCase() ?? '';
  const { data: myStaff } = useFirestoreDoc<Staff>(
    emailLower ? `${COLLECTIONS.staff}/${emailLower}` : '',
  );
  const { data: allModules } = useFirestoreCollection<ModuleDoc>(COLLECTIONS.modules);

  // Modules this user is assigned that have a staff-facing page → sidebar items.
  const moduleNavItems: NavItem[] = (() => {
    if (!myStaff || !allModules) return [];
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Firestore reads bypass Zod defaults; older staff docs may lack `modules`
    const assigned = new Set(myStaff.modules ?? []);
    for (const m of allModules) {
      if (staffMatchesAutoEnable(myStaff, m.autoEnable ?? null)) assigned.add(m.moduleId);
    }
    return allModules
      .filter((m) => m.hasPage && m.isActive && assigned.has(m.moduleId))
      .slice()
      .sort((a, b) => a.displayName.localeCompare(b.displayName))
      .map((m) => ({
        icon: moduleIconComponent(m.icon),
        label: m.displayName,
        href: `/m/${m.moduleId}`,
      }));
  })();

  const rubricDomainItems = (() => {
    if (!claims.role || !roles || !rubrics) return [] as NavSubItem[];
    const role = roles.find((r) => r.roleId === claims.role);
    if (!role) return [] as NavSubItem[];
    const rubric = rubrics.find((rb) => rb.id === role.rubricId);
    if (!rubric) return [] as NavSubItem[];
    return rubric.domains.map((d) => ({
      label: `D${d.id} ${d.name}`,
      href: `/my-rubric#domain-${d.id}`,
    }));
  })();
  // Explicit per-section open/close overrides. If a label has no entry,
  // fall back to "open if a child route is currently active" — that
  // auto-expands Observations when you're sitting on /observations.
  // Once the user manually toggles, their choice sticks (so they can
  // collapse the section even while on a child route).
  const [explicitOpen, setExplicitOpen] = useState<Map<string, boolean>>(new Map());

  // Admin sub-nav is an accordion: one section open at a time so the panel
  // never needs to scroll. The section containing the current route opens
  // automatically; the user can still toggle freely from there.
  const activeAdminSection =
    ADMIN_NAV_SECTIONS.find((s) =>
      s.items.some(
        (it) => location.pathname === it.to || location.pathname.startsWith(it.to + '/'),
      ),
    )?.label ?? null;
  const [openAdminSection, setOpenAdminSection] = useState<string | null>(activeAdminSection);

  useEffect(() => {
    if (activeAdminSection) setOpenAdminSection(activeAdminSection);
  }, [activeAdminSection]);

  const onCloseMobileRef = useRef(onCloseMobile);
  useLayoutEffect(() => {
    onCloseMobileRef.current = onCloseMobile;
  });

  useEffect(() => {
    onCloseMobileRef.current();
  }, [location.pathname]);

  const handleSignOut = useCallback(() => void signOut(), [signOut]);
  const navConfig = buildNavItems(
    claims.role,
    handleSignOut,
    {
      hasWorkProduct,
      hasInstructionalRound,
      isAdmin: claims.isAdmin,
    },
    rubricDomainItems,
  );
  if (moduleNavItems.length > 0) {
    navConfig.main = [...navConfig.main, ...moduleNavItems];
  }
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
      {/* Mobile backdrop — sits below the persistent AppHeader so the
          dimming starts where the drawer does. */}
      {mobileOpen && (
        <div
          className="fixed top-[52px] right-0 bottom-0 left-0 z-30 bg-black/40 xl:hidden"
          onClick={onCloseMobile}
          aria-hidden="true"
        />
      )}

      {/* Sidebar — slides in under the AppHeader (top-[52px]) so the
          header stays visible and interactive while the drawer is open. */}
      <nav
        className={cn(
          'bg-ops-blue-dark fixed top-[52px] bottom-0 left-0 z-40 flex flex-col text-white',
          // Subtle right drop-shadow gives the sidebar depth without the
          // hard-edge feel of a colored divider.
          'shadow-[2px_0_10px_rgba(0,0,0,0.18)]',
          'w-60 transition-all duration-200',
          mobileOpen ? 'translate-x-0' : '-translate-x-full xl:translate-x-0',
          pcExpanded ? 'xl:w-60' : 'xl:w-14',
        )}
        aria-label="Main navigation"
      >
        {/* User identity strip — first thing inside the sidebar now that
            AppHeader owns the brand. */}
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
                {...prefetchHandlersFor('/my-rubric')}
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
              <div className={showLabels ? 'px-2' : 'px-1'}>
                {ADMIN_NAV_SECTIONS.map((section, sectionIndex) => {
                  const sectionOpen = openAdminSection === section.label;
                  return (
                    <div key={section.label} className="mb-1.5">
                      {showLabels ? (
                        <button
                          type="button"
                          onClick={() =>
                            setOpenAdminSection((prev) =>
                              prev === section.label ? null : section.label,
                            )
                          }
                          aria-expanded={sectionOpen}
                          className="flex w-full items-center gap-1 rounded-md px-2 pt-2 pb-1 text-[10px] font-semibold tracking-wider text-white/40 uppercase transition-colors hover:text-white/70"
                        >
                          <span className="flex-1 text-left">{section.label}</span>
                          {sectionOpen ? (
                            <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                          )}
                        </button>
                      ) : sectionIndex > 0 ? (
                        <div className="mx-2 my-1.5 border-t border-white/10" aria-hidden="true" />
                      ) : null}
                      {(!showLabels || sectionOpen) && (
                        <ul className="space-y-0.5">
                          {section.items.map(({ to, label, icon: Icon }) => (
                            <li key={to}>
                              <NavLink
                                to={to}
                                end
                                {...prefetchHandlersFor(to)}
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
                      )}
                    </div>
                  );
                })}
              </div>
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
  const navigate = useNavigate();
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
          onClick={() => {
            if (item.href) void navigate(item.href);
            onToggleSection(item.label);
          }}
          {...prefetchHandlersFor(item.href)}
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
              const childActive = isExactChildActive(child.href, location);
              return (
                <li key={child.href}>
                  <Link
                    to={child.href}
                    {...prefetchHandlersFor(child.href)}
                    className={cn(
                      'block rounded-md py-1.5 pr-2 pl-3 text-sm transition-colors',
                      childActive
                        ? 'bg-white/15 text-white hover:bg-white/20'
                        : 'text-white/70 hover:bg-white/10 hover:text-white',
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
    <Link
      to={item.href}
      {...prefetchHandlersFor(item.href)}
      className={cn(baseItemCls, isActive && 'bg-white/15 text-white')}
    >
      <item.icon className="h-5 w-5 shrink-0" />
      {showLabels && <span>{item.label}</span>}
    </Link>
  );
}
