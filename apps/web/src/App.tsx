import { Component, lazy, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { AuthProvider } from '@/auth/AuthProvider';
import { RequireAuth } from '@/auth/RequireAuth';
import { SignInScreen } from '@/auth/SignInScreen';
import { Layout } from '@/components/Layout';
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

class RouteErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError(error: unknown) {
    console.error('[RouteErrorBoundary] Failed to load route:', error);
    return { hasError: true };
  }
  override render() {
    if (this.state.hasError) {
      return (
        <p className="text-muted-foreground py-12 text-center text-sm">
          Failed to load page. Try refreshing.
        </p>
      );
    }
    return this.props.children;
  }
}

// Resets the error boundary on every navigation so users can recover from
// transient chunk-load failures without a full page reload.
function KeyedErrorBoundary({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return <RouteErrorBoundary key={pathname}>{children}</RouteErrorBoundary>;
}

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
      <DevModeProvider>
        <KeyedErrorBoundary>
          <Routes>
            {/* Public */}
            <Route path="/sign-in" element={<SignInScreen />} />
            {DevSignIn ? <Route path="/dev-sign-in" element={<DevSignIn />} /> : null}

            {/* Authenticated routes (no special access required) */}
            <Route element={<StandardShell />}>
              <Route path="/" element={<RoleAwareRedirect />} />
              <Route path="/dashboard" element={<L.StaffDashboardPage />} />
              <Route path="/my-rubric" element={<L.MyRubricPage />} />
              <Route path="/profile" element={<L.ProfilePage />} />
              <Route path="/unauthorized" element={<Unauthorized />} />
              <Route path="/observations/:observationId" element={<L.ObservationEditorPage />} />
              <Route path="/book/:windowId" element={<L.BookingPage />} />
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
                <Route path="buildings" element={<L.BuildingsPage />} />
                <Route path="buildings/:buildingId/schedule" element={<L.BuildingSchedulePage />} />
                <Route path="signup-fields" element={<L.SignupFieldsPage />} />
                <Route path="scheduling-settings" element={<L.SchedulingSettingsPage />} />
                <Route path="rubrics" element={<L.RubricsListPage />} />
                <Route path="rubrics/:rubricId" element={<L.RubricEditorPage />} />
                <Route path="role-year-mappings" element={<L.RoleYearMappingsPage />} />
                <Route path="work-product" element={<L.WorkProductPage />} />
                <Route path="email-templates" element={<L.EmailTemplatesPage />} />
                <Route path="branding" element={<L.BrandingPage />} />
                <Route path="dashboard" element={<L.DashboardSettingsPage />} />
                <Route path="settings" element={<L.SettingsPage />} />
                <Route path="audit-log" element={<L.AuditLogPage />} />
              </Route>
            </Route>

            <Route path="*" element={<NotFound />} />
          </Routes>
        </KeyedErrorBoundary>
      </DevModeProvider>
    </AuthProvider>
  );
}
