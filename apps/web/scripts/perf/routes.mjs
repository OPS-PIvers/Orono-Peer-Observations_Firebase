// Canonical list of routes exercised by the page-load perf harness.
//
// Every navigable path in the app appears here so the harness measures
// "every page" under identical conditions. Paths with URL params use a
// representative sample value. Auth-gated routes resolve client-side to the
// sign-in screen when unauthenticated, but the navigation still loads and
// executes the full critical-path bundle (HTML + entry + react-vendor +
// firebase + router), which is exactly the shared cost this harness tracks.
export const ROUTES = [
  { name: 'sign-in', path: '/sign-in' },
  { name: 'root-redirect', path: '/' },
  { name: 'dashboard', path: '/dashboard' },
  { name: 'my-observations', path: '/my-observations' },
  { name: 'my-rubric', path: '/my-rubric' },
  { name: 'profile', path: '/profile' },
  { name: 'unauthorized', path: '/unauthorized' },
  { name: 'observation-editor', path: '/observations/obs-123' },
  { name: 'booking', path: '/book/win-123' },
  { name: 'calendar-callback', path: '/oauth/google-calendar/callback' },
  { name: 'module', path: '/m/mod-123' },
  { name: 'observations-list', path: '/observations' },
  { name: 'new-observation', path: '/observations/new' },
  { name: 'my-windows', path: '/observations/windows' },
  { name: 'assign-preferences', path: '/observations/windows/win-123/assign' },
  { name: 'staff-directory', path: '/staff' },
  { name: 'staff-person', path: '/staff/jane%40orono.k12.mn.us' },
  { name: 'my-staff', path: '/my-staff' },
  { name: 'admin-staff', path: '/admin/staff' },
  { name: 'admin-roles', path: '/admin/roles' },
  { name: 'admin-modules', path: '/admin/modules' },
  { name: 'admin-module-builder', path: '/admin/modules/mod-123' },
  { name: 'admin-buildings', path: '/admin/buildings' },
  { name: 'admin-building-schedule', path: '/admin/buildings/bld-123/schedule' },
  { name: 'admin-signup-fields', path: '/admin/signup-fields' },
  { name: 'admin-scheduling-settings', path: '/admin/scheduling-settings' },
  { name: 'admin-rubrics', path: '/admin/rubrics' },
  { name: 'admin-rubric-editor', path: '/admin/rubrics/rub-123' },
  { name: 'admin-role-year-mappings', path: '/admin/role-year-mappings' },
  { name: 'admin-work-product', path: '/admin/work-product' },
  { name: 'admin-email-templates', path: '/admin/email-templates' },
  { name: 'admin-branding', path: '/admin/branding' },
  { name: 'admin-dashboard', path: '/admin/dashboard' },
  { name: 'admin-settings', path: '/admin/settings' },
  { name: 'admin-audit-log', path: '/admin/audit-log' },
  { name: 'admin-transcription', path: '/admin/transcription-jobs' },
  { name: 'not-found', path: '/this-route-does-not-exist' },
];
