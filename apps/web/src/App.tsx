import { Component, lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { AuthProvider } from '@/auth/AuthProvider';
import { RequireAuth } from '@/auth/RequireAuth';
import { SignInScreen } from '@/auth/SignInScreen';
import { Layout } from '@/components/Layout';
import { ObservationsListPage } from '@/observations/ObservationsListPage';
import { MyRubricPage } from '@/routes/MyRubricPage';
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

// Code-split heavy routes. Admin pages and the observation editor pull
// in Tiptap, the audio recorder, and the rubric editor surface — all
// pages a typical user opens at most a few times per session, well
// outside the critical sign-in / list path.
const AdminLayout = lazy(() =>
  import('@/admin/AdminLayout').then((m) => ({ default: m.AdminLayout })),
);
const AuditLogPage = lazy(() =>
  import('@/admin/audit-log/AuditLogPage').then((m) => ({ default: m.AuditLogPage })),
);
const BrandingPage = lazy(() =>
  import('@/admin/branding/BrandingPage').then((m) => ({ default: m.BrandingPage })),
);
const RolesPage = lazy(() =>
  import('@/admin/roles/RolesPage').then((m) => ({ default: m.RolesPage })),
);
const RoleYearMappingsPage = lazy(() =>
  import('@/admin/role-year-mappings/RoleYearMappingsPage').then((m) => ({
    default: m.RoleYearMappingsPage,
  })),
);
const RubricEditorPage = lazy(() =>
  import('@/admin/rubrics/RubricEditorPage').then((m) => ({ default: m.RubricEditorPage })),
);
const RubricsListPage = lazy(() =>
  import('@/admin/rubrics/RubricsListPage').then((m) => ({ default: m.RubricsListPage })),
);
const SettingsPage = lazy(() =>
  import('@/admin/settings/SettingsPage').then((m) => ({ default: m.SettingsPage })),
);
const StaffPage = lazy(() =>
  import('@/admin/staff/StaffPage').then((m) => ({ default: m.StaffPage })),
);
const WorkProductPage = lazy(() =>
  import('@/admin/work-product/WorkProductPage').then((m) => ({ default: m.WorkProductPage })),
);
const EmailTemplatesPage = lazy(() =>
  import('@/admin/email-templates/EmailTemplatesPage').then((m) => ({
    default: m.EmailTemplatesPage,
  })),
);
const NewObservationPage = lazy(() =>
  import('@/observations/NewObservationPage').then((m) => ({ default: m.NewObservationPage })),
);
const ObservationEditorPage = lazy(() =>
  import('@/observations/ObservationEditorPage').then((m) => ({
    default: m.ObservationEditorPage,
  })),
);
const StaffDirectoryPage = lazy(() =>
  import('@/routes/StaffDirectoryPage').then((m) => ({ default: m.StaffDirectoryPage })),
);
const StaffPersonPage = lazy(() =>
  import('@/routes/StaffPersonPage').then((m) => ({ default: m.StaffPersonPage })),
);
const MyStaffPage = lazy(() =>
  import('@/routes/MyStaffPage').then((m) => ({ default: m.MyStaffPage })),
);

function RouteFallback() {
  return <p className="text-muted-foreground py-12 text-center text-sm">Loading…</p>;
}

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
  return <StaffPersonPage key={email} />;
}

export function App() {
  return (
    <AuthProvider>
      <KeyedErrorBoundary>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            {/* Public */}
            <Route path="/sign-in" element={<SignInScreen />} />
            {DevSignIn ? <Route path="/dev-sign-in" element={<DevSignIn />} /> : null}

            {/* Authenticated routes wrapped in Layout */}
            <Route
              path="/"
              element={
                <RequireAuth>
                  <Layout>
                    <RoleAwareRedirect />
                  </Layout>
                </RequireAuth>
              }
            />
            {/* /dashboard kept for bookmarks; redirects through "/" so RoleAwareRedirect applies */}
            <Route path="/dashboard" element={<Navigate to="/" replace />} />
            <Route
              path="/observations"
              element={
                <RequireAuth requireSpecialAccess>
                  <Layout>
                    <ObservationsListPage />
                  </Layout>
                </RequireAuth>
              }
            />
            <Route
              path="/observations/new"
              element={
                <RequireAuth requireSpecialAccess>
                  <Layout>
                    <NewObservationPage />
                  </Layout>
                </RequireAuth>
              }
            />
            <Route
              path="/observations/:observationId"
              element={
                <RequireAuth>
                  <Layout>
                    <ObservationEditorPage />
                  </Layout>
                </RequireAuth>
              }
            />
            {/* Staff directory — PE and Full Access */}
            <Route
              path="/staff"
              element={
                <RequireAuth requireSpecialAccess>
                  <Layout>
                    <StaffDirectoryPage />
                  </Layout>
                </RequireAuth>
              }
            />
            {/* Per-person observation hub */}
            <Route
              path="/staff/:email"
              element={
                <RequireAuth requireSpecialAccess>
                  <Layout>
                    <KeyedStaffPersonPage />
                  </Layout>
                </RequireAuth>
              }
            />
            {/* Admin building-scoped staff list */}
            <Route
              path="/my-staff"
              element={
                <RequireAuth requireSpecialAccess>
                  <Layout>
                    <MyStaffPage />
                  </Layout>
                </RequireAuth>
              }
            />
            <Route
              path="/my-rubric"
              element={
                <RequireAuth>
                  <Layout>
                    <MyRubricPage />
                  </Layout>
                </RequireAuth>
              }
            />
            <Route
              path="/unauthorized"
              element={
                <RequireAuth>
                  <Layout>
                    <Unauthorized />
                  </Layout>
                </RequireAuth>
              }
            />

            {/* Admin section (gated to Administrator + Full Access) */}
            <Route
              path="/admin"
              element={
                <RequireAuth requireAdmin>
                  <Layout>
                    <AdminLayout />
                  </Layout>
                </RequireAuth>
              }
            >
              <Route index element={<Navigate to="staff" replace />} />
              <Route path="staff" element={<StaffPage />} />
              <Route path="roles" element={<RolesPage />} />
              <Route path="rubrics" element={<RubricsListPage />} />
              <Route path="rubrics/:rubricId" element={<RubricEditorPage />} />
              <Route path="role-year-mappings" element={<RoleYearMappingsPage />} />
              <Route path="work-product" element={<WorkProductPage />} />
              <Route path="email-templates" element={<EmailTemplatesPage />} />
              <Route path="branding" element={<BrandingPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="audit-log" element={<AuditLogPage />} />
            </Route>

            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </KeyedErrorBoundary>
    </AuthProvider>
  );
}
