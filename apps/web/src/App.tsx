import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '@/auth/AuthProvider';
import { RequireAuth } from '@/auth/RequireAuth';
import { SignInScreen } from '@/auth/SignInScreen';
import { Layout } from '@/components/Layout';
import { AdminLayout } from '@/admin/AdminLayout';
import { AuditLogPage } from '@/admin/audit-log/AuditLogPage';
import { BrandingPage } from '@/admin/branding/BrandingPage';
import { RolesPage } from '@/admin/roles/RolesPage';
import { RoleYearMappingsPage } from '@/admin/role-year-mappings/RoleYearMappingsPage';
import { RubricEditorPage } from '@/admin/rubrics/RubricEditorPage';
import { RubricsListPage } from '@/admin/rubrics/RubricsListPage';
import { SettingsPage } from '@/admin/settings/SettingsPage';
import { StaffPage } from '@/admin/staff/StaffPage';
import { WorkProductPage } from '@/admin/work-product/WorkProductPage';
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
          <Route path="roles" element={<RolesPage />} />
          <Route path="rubrics" element={<RubricsListPage />} />
          <Route path="rubrics/:rubricId" element={<RubricEditorPage />} />
          <Route path="role-year-mappings" element={<RoleYearMappingsPage />} />
          <Route path="work-product" element={<WorkProductPage />} />
          <Route path="branding" element={<BrandingPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="audit-log" element={<AuditLogPage />} />
        </Route>

        {/* Phase 4 mounts these — placeholders for now */}
        <Route path="/observations/*" element={<Navigate to="/dashboard" replace />} />

        <Route path="*" element={<NotFound />} />
      </Routes>
    </AuthProvider>
  );
}
