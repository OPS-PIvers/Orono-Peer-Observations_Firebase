import type { ReactNode } from 'react';
import { Outlet } from 'react-router-dom';
import { useIsViewingAs } from '@/dev/DevModeContext';

/**
 * Admin section shell. The admin sub-nav lives in the primary AppSidebar
 * (slide-in panel keyed off /admin/* routes); this layout is a thin
 * wrapper that renders the matched admin route.
 *
 * While a developer views as someone (dev view-as is read-only), the console
 * renders but is inert: its many write paths aren't individually guarded.
 */
export function AdminLayout({ children }: { children?: ReactNode }) {
  const isViewingAs = useIsViewingAs();
  return <section inert={isViewingAs}>{children ?? <Outlet />}</section>;
}
