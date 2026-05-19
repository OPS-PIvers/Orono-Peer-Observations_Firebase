import { lazy } from 'react';

/**
 * Central registry for code-split route components plus a hover/focus
 * prefetch API. Two goals:
 *
 *   1. Single source of truth so route definitions and the sidebar's
 *      prefetch handlers can't drift out of sync.
 *   2. Vite caches the dynamic-import promise, so calling `prefetch(name)`
 *      multiple times is free — it just kicks the chunk into the browser
 *      cache before the user clicks.
 */

const importers = {
  StaffDashboardPage: () => import('@/dashboard/StaffDashboardPage'),
  DashboardSettingsPage: () => import('@/admin/dashboard/DashboardSettingsPage'),
  ModulesPage: () => import('@/admin/modules/ModulesPage'),
  MyRubricPage: () => import('@/routes/MyRubricPage'),
  MyStaffPage: () => import('@/routes/MyStaffPage'),
  ProfilePage: () => import('@/routes/ProfilePage'),
  StaffDirectoryPage: () => import('@/routes/StaffDirectoryPage'),
  StaffPersonPage: () => import('@/routes/StaffPersonPage'),
  ObservationsListPage: () => import('@/observations/ObservationsListPage'),
  NewObservationPage: () => import('@/observations/NewObservationPage'),
  ObservationEditorPage: () => import('@/observations/ObservationEditorPage'),
  AdminLayout: () => import('@/admin/AdminLayout'),
  StaffPage: () => import('@/admin/staff/StaffPage'),
  RolesPage: () => import('@/admin/roles/RolesPage'),
  BuildingsPage: () => import('@/admin/buildings/BuildingsPage'),
  RubricsListPage: () => import('@/admin/rubrics/RubricsListPage'),
  RubricEditorPage: () => import('@/admin/rubrics/RubricEditorPage'),
  RoleYearMappingsPage: () => import('@/admin/role-year-mappings/RoleYearMappingsPage'),
  WorkProductPage: () => import('@/admin/work-product/WorkProductPage'),
  EmailTemplatesPage: () => import('@/admin/email-templates/EmailTemplatesPage'),
  BrandingPage: () => import('@/admin/branding/BrandingPage'),
  SettingsPage: () => import('@/admin/settings/SettingsPage'),
  AuditLogPage: () => import('@/admin/audit-log/AuditLogPage'),
} as const;

export type RouteName = keyof typeof importers;

export const StaffDashboardPage = lazy(() =>
  importers.StaffDashboardPage().then((m) => ({ default: m.StaffDashboardPage })),
);
export const DashboardSettingsPage = lazy(() =>
  importers.DashboardSettingsPage().then((m) => ({ default: m.DashboardSettingsPage })),
);
export const MyRubricPage = lazy(() =>
  importers.MyRubricPage().then((m) => ({ default: m.MyRubricPage })),
);
export const MyStaffPage = lazy(() =>
  importers.MyStaffPage().then((m) => ({ default: m.MyStaffPage })),
);
export const ProfilePage = lazy(() =>
  importers.ProfilePage().then((m) => ({ default: m.ProfilePage })),
);
export const StaffDirectoryPage = lazy(() =>
  importers.StaffDirectoryPage().then((m) => ({ default: m.StaffDirectoryPage })),
);
export const StaffPersonPage = lazy(() =>
  importers.StaffPersonPage().then((m) => ({ default: m.StaffPersonPage })),
);
export const ObservationsListPage = lazy(() =>
  importers.ObservationsListPage().then((m) => ({ default: m.ObservationsListPage })),
);
export const NewObservationPage = lazy(() =>
  importers.NewObservationPage().then((m) => ({ default: m.NewObservationPage })),
);
export const ObservationEditorPage = lazy(() =>
  importers.ObservationEditorPage().then((m) => ({ default: m.ObservationEditorPage })),
);
export const AdminLayout = lazy(() =>
  importers.AdminLayout().then((m) => ({ default: m.AdminLayout })),
);
export const StaffPage = lazy(() => importers.StaffPage().then((m) => ({ default: m.StaffPage })));
export const ModulesPage = lazy(() =>
  importers.ModulesPage().then((m) => ({ default: m.ModulesPage })),
);
export const RolesPage = lazy(() => importers.RolesPage().then((m) => ({ default: m.RolesPage })));
export const BuildingsPage = lazy(() =>
  importers.BuildingsPage().then((m) => ({ default: m.BuildingsPage })),
);
export const RubricsListPage = lazy(() =>
  importers.RubricsListPage().then((m) => ({ default: m.RubricsListPage })),
);
export const RubricEditorPage = lazy(() =>
  importers.RubricEditorPage().then((m) => ({ default: m.RubricEditorPage })),
);
export const RoleYearMappingsPage = lazy(() =>
  importers.RoleYearMappingsPage().then((m) => ({ default: m.RoleYearMappingsPage })),
);
export const WorkProductPage = lazy(() =>
  importers.WorkProductPage().then((m) => ({ default: m.WorkProductPage })),
);
export const EmailTemplatesPage = lazy(() =>
  importers.EmailTemplatesPage().then((m) => ({ default: m.EmailTemplatesPage })),
);
export const BrandingPage = lazy(() =>
  importers.BrandingPage().then((m) => ({ default: m.BrandingPage })),
);
export const SettingsPage = lazy(() =>
  importers.SettingsPage().then((m) => ({ default: m.SettingsPage })),
);
export const AuditLogPage = lazy(() =>
  importers.AuditLogPage().then((m) => ({ default: m.AuditLogPage })),
);

export function prefetch(name: RouteName): void {
  void importers[name]();
}

/** URL pathname → RouteName map so the sidebar can prefetch by href
 *  without hardcoding component names at every NavLink. */
export const PREFETCH_BY_PATH: Record<string, RouteName> = {
  '/dashboard': 'StaffDashboardPage',
  '/admin/dashboard': 'DashboardSettingsPage',
  '/my-rubric': 'MyRubricPage',
  '/my-staff': 'MyStaffPage',
  '/staff': 'StaffDirectoryPage',
  '/observations': 'ObservationsListPage',
  '/observations/new': 'NewObservationPage',
  '/profile': 'ProfilePage',
  '/admin': 'AdminLayout',
  '/admin/staff': 'StaffPage',
  '/admin/modules': 'ModulesPage',
  '/admin/roles': 'RolesPage',
  '/admin/buildings': 'BuildingsPage',
  '/admin/rubrics': 'RubricsListPage',
  '/admin/role-year-mappings': 'RoleYearMappingsPage',
  '/admin/work-product': 'WorkProductPage',
  '/admin/email-templates': 'EmailTemplatesPage',
  '/admin/branding': 'BrandingPage',
  '/admin/settings': 'SettingsPage',
  '/admin/audit-log': 'AuditLogPage',
};
