import type { ReactNode } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { cn } from '@/lib/utils';

const ADMIN_NAV = [
  { to: '/admin/staff', label: 'Staff' },
  { to: '/admin/roles', label: 'Roles' },
  { to: '/admin/rubrics', label: 'Rubrics' },
  { to: '/admin/role-year-mappings', label: 'Role/Year' },
  { to: '/admin/work-product', label: 'Work Product' },
  { to: '/admin/branding', label: 'Branding' },
  { to: '/admin/settings', label: 'Settings' },
  { to: '/admin/audit-log', label: 'Audit Log' },
] as const;

/**
 * Admin section shell — sub-nav on the left, route outlet on the right.
 * Mounted under /admin/* and gated by RequireAuth({ requireAdmin: true }).
 */
export function AdminLayout({ children }: { children?: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-[200px_minmax(0,1fr)]">
      <aside className="border-border bg-background rounded-lg border p-2">
        <nav className="flex flex-col gap-1">
          {ADMIN_NAV.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              end
              className={({ isActive }) =>
                cn(
                  'rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-foreground hover:bg-accent hover:text-accent-foreground',
                )
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <section>{children ?? <Outlet />}</section>
    </div>
  );
}
