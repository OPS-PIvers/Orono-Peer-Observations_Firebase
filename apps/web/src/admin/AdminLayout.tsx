import type { ReactNode } from 'react';
import { Outlet } from 'react-router-dom';

/**
 * Admin section shell. The admin sub-nav lives in the primary AppSidebar
 * (slide-in panel keyed off /admin/* routes); this layout is a thin
 * wrapper that renders the matched admin route.
 */
export function AdminLayout({ children }: { children?: ReactNode }) {
  return <section>{children ?? <Outlet />}</section>;
}
