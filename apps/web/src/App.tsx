import { lazy } from 'react';
import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import { AuthProvider } from '@/auth/AuthProvider';
import { RequireAuth } from '@/auth/RequireAuth';
import { SignInScreen } from '@/auth/SignInScreen';
import { BrandingProvider } from '@/components/BrandingProvider';
import { AppErrorBoundary } from '@/components/ErrorBoundary';
import { Layout } from '@/components/Layout';
import { Toaster } from '@/components/ui/sonner';
import { DevModeProvider } from '@/dev/DevModeContext';
import * as L from '@/lazyRoutes';
import { NotFound } from '@/routes/NotFound';
import { RoleAwareRedirect } from '@/routes/RoleAwareRedirect';
import { Unauthorized } from '@/routes/Unauthorized';

// Dev-only sign-in helper. Lazy-loaded so production bundles tree-shake
// the entire DevSignIn module + route registration. Only available when
// `import.meta.env.MODE === 'development'` (Vite's dev server).
const DevSignIn =
  import.meta.env.MODE === 'development'
    ? lazy(() => import('@/auth/DevSignIn').then((m) => ({ default: m.DevSignIn })))
    : null;

// Forces StaffPersonPage to remount when :email changes so the Firestore
// subscription (keyed on constraint types, not values) is always fresh.
function KeyedStaffPersonPage() {
  const { email } = useParams<{ email: string }>();
  return <L.StaffPersonPage key={email} />;
}

// Layout route: RequireAuth runs once, Layout mounts once and persists
// across child navigations via <Outlet />. The Suspense boundary lives
// inside Layout (around <Outlet />), so when a lazy child page chunk is
// loading, only the main content area suspends — the sidebar and header
// stay on screen.
interface ShellProps {
  requireAdmin?: boolean;
  requireSpecialAccess?: boolean;
}
function StandardShell({ requireAdmin = false, requireSpecialAccess = false }: ShellProps) {
  return (
    <RequireAuth requireAdmin={requireAdmin} requireSpecialAccess={requireSpecialAccess}>
      <Layout />
    </RequireAuth>
  );
}

export function App() {
  return (
    <AuthProvider>
      <BrandingProvider>
        <DevModeProvider>
          <AppErrorBoundary>
            <Routes>
              {/* Public */}
              <Route path="/sign-in" element={<SignInScreen />} />
              {DevSignIn ? <Route path="/dev-sign-in" element={<DevSignIn />} /> : null}

              {/* Authenticated routes (no special access required) */}
              <Route element={<StandardShell />}>
                <Route path="/" element={<RoleAwareRedirect />} />
                <Route path="/dashboard" element={<L.StaffDashboardPage />} />
                <Route path="/my-observations" element={<L.MyObservationsPage />} />
                <Route path="/my-rubric" element={<L.MyRubricPage />} />
                <Route path="/profile" element={<L.ProfilePage />} />
                <Route path="/unauthorized" element={<Unauthorized />} />
                <Route path="/observations/:observationId" element={<L.ObservationEditorPage />} />
                <Route path="/book/:windowId" element={<L.BookingPage />} />
                <Route
                  path="/oauth/google-calendar/callback"
                  element={<L.CalendarCallbackPage />}
                />
                <Route path="/m/:moduleId" element={<L.ModulePage />} />
              </Route>

              {/* Special access (PE + Full Access) */}
              <Route element={<StandardShell requireSpecialAccess />}>
                <Route path="/observations" element={<L.ObservationsListPage />} />
                <Route path="/observations/new" element={<L.NewObservationPage />} />
                <Route path="/observations/windows" element={<L.MyObservationWindowsPage />} />
                <Route
                  path="/observations/windows/:windowId/assign"
                  element={<L.AssignPreferencesPage />}
                />
                <Route path="/staff" element={<L.StaffDirectoryPage />} />
                <Route path="/staff/:email" element={<KeyedStaffPersonPage />} />
                <Route path="/my-staff" element={<L.MyStaffPage />} />
              </Route>

              {/* Admin section (gated to Administrator + Full Access) */}
              <Route element={<StandardShell requireAdmin />}>
                <Route path="/admin" element={<L.AdminLayout />}>
                  <Route index element={<Navigate to="staff" replace />} />
                  <Route path="staff" element={<L.StaffPage />} />
                  <Route path="roles" element={<L.RolesPage />} />
                  <Route path="modules" element={<L.ModulesPage />} />
                  <Route path="modules/:moduleId" element={<L.ModuleBuilderPage />} />
                  <Route path="buildings" element={<L.BuildingsPage />} />
                  <Route
                    path="buildings/:buildingId/schedule"
                    element={<L.BuildingSchedulePage />}
                  />
                  <Route path="signup-fields" element={<L.SignupFieldsPage />} />
                  <Route path="scheduling-settings" element={<L.SchedulingSettingsPage />} />
                  <Route path="rubrics" element={<L.RubricsListPage />} />
                  <Route path="rubrics/:rubricId" element={<L.RubricEditorPage />} />
                  <Route path="role-year-mappings" element={<L.RoleYearMappingsPage />} />
                  <Route path="observation-questions" element={<L.WorkProductPage />} />
                  {/* The bank lived here while it only held Work Product
                      questions; keep the old path working for stale bookmarks. */}
                  <Route
                    path="work-product"
                    element={<Navigate to="/admin/observation-questions" replace />}
                  />
                  <Route path="email-templates" element={<L.EmailTemplatesPage />} />
                  <Route path="branding" element={<L.BrandingPage />} />
                  <Route path="dashboard" element={<L.DashboardSettingsPage />} />
                  <Route path="settings" element={<L.SettingsPage />} />
                  <Route path="audit-log" element={<L.AuditLogPage />} />
                  <Route path="transcription-jobs" element={<L.TranscriptionJobsPage />} />
                </Route>
              </Route>

              <Route path="*" element={<NotFound />} />
            </Routes>
          </AppErrorBoundary>
          <Toaster />
        </DevModeProvider>
      </BrandingProvider>
    </AuthProvider>
  );
}
