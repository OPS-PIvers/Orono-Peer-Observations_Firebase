import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '@/auth/AuthProvider';
import { RequireAuth } from '@/auth/RequireAuth';
import { SignInScreen } from '@/auth/SignInScreen';
import { Layout } from '@/components/Layout';
import { AdminLayout } from '@/admin/AdminLayout';
import { AdminPlaceholder } from '@/admin/AdminPlaceholder';
import { StaffPage } from '@/admin/staff/StaffPage';
import { Dashboard } from '@/routes/Dashboard';
import { MyRubric } from '@/routes/MyRubric';
import { NotFound } from '@/routes/NotFound';
import { RoleAwareRedirect } from '@/routes/RoleAwareRedirect';
import { Unauthorized } from '@/routes/Unauthorized';

export function App() {
  return (
    <AuthProvider>
      <Routes>
        {/* Public */}
        <Route path="/sign-in" element={<SignInScreen />} />

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
        <Route
          path="/dashboard"
          element={
            <RequireAuth requireSpecialAccess>
              <Layout>
                <Dashboard />
              </Layout>
            </RequireAuth>
          }
        />
        <Route
          path="/my-rubric"
          element={
            <RequireAuth>
              <Layout>
                <MyRubric />
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
          <Route
            path="roles"
            element={<AdminPlaceholder title="Roles" phase="Phase 3 (next commit)" />}
          />
          <Route
            path="rubrics"
            element={<AdminPlaceholder title="Rubrics" phase="Phase 3 (next commit)" />}
          />
          <Route
            path="role-year-mappings"
            element={
              <AdminPlaceholder title="Role / Year Mappings" phase="Phase 3 (next commit)" />
            }
          />
          <Route
            path="work-product"
            element={
              <AdminPlaceholder title="Work Product Questions" phase="Phase 3 (next commit)" />
            }
          />
          <Route
            path="branding"
            element={<AdminPlaceholder title="Branding" phase="Phase 3 (next commit)" />}
          />
          <Route
            path="settings"
            element={<AdminPlaceholder title="App Settings" phase="Phase 3 (next commit)" />}
          />
          <Route
            path="audit-log"
            element={<AdminPlaceholder title="Audit Log" phase="Phase 3 (next commit)" />}
          />
        </Route>

        {/* Phase 4 mounts these — placeholders for now */}
        <Route path="/observations/*" element={<Navigate to="/dashboard" replace />} />

        <Route path="*" element={<NotFound />} />
      </Routes>
    </AuthProvider>
  );
}
