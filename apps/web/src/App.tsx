import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '@/auth/AuthProvider';
import { RequireAuth } from '@/auth/RequireAuth';
import { SignInScreen } from '@/auth/SignInScreen';
import { Layout } from '@/components/Layout';
import { Dashboard } from '@/routes/Dashboard';
import { MyRubric } from '@/routes/MyRubric';
import { NotFound } from '@/routes/NotFound';
import { RoleAwareRedirect } from '@/routes/RoleAwareRedirect';
import { Unauthorized } from '@/routes/Unauthorized';

export function App() {
  return (
    <AuthProvider>
      <Routes>
        {/* Public routes */}
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

        {/* Phase 3 admin section, Phase 4 observation routes mount here later */}
        <Route path="/admin/*" element={<Navigate to="/dashboard" replace />} />
        <Route path="/observations/*" element={<Navigate to="/dashboard" replace />} />

        <Route path="*" element={<NotFound />} />
      </Routes>
    </AuthProvider>
  );
}
