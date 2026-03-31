import { lazy, Suspense, useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { PageLoader } from '@/shared/ui/PageLoader';
import { ProtectedRoute } from './ProtectedRoute';
import { AdminRoute } from './AdminRoute';
import { AdminLayout } from '@/pages/admin/ui/AdminLayout';
import { AdminDashboard } from '@/pages/admin/ui/AdminDashboard';
import { AdminUsers } from '@/pages/admin/ui/AdminUsers';
import { AdminPromotions } from '@/pages/admin/ui/AdminPromotions';
import { AdminAuditLog } from '@/pages/admin/ui/AdminAuditLog';
import { AdminAnalytics } from '@/pages/admin/ui/AdminAnalytics';
import { AdminPayments } from '@/pages/admin/ui/AdminPayments';
import { AdminModeration } from '@/pages/admin/ui/AdminModeration';
import { AdminHealth } from '@/pages/admin/ui/AdminHealth';

const IndexPage = lazy(() => import('@/pages/index'));
const LoginPage = lazy(() => import('@/pages/login'));
const MandalaSettingsPage = lazy(() => import('@/pages/mandala-settings'));
const MandalasPage = lazy(() => import('@/pages/mandalas'));
const ProfilePage = lazy(() => import('@/pages/profile'));
const SubscriptionPage = lazy(() => import('@/pages/subscription'));
const SettingsPage = lazy(() => import('@/pages/settings'));
const PrivacyPage = lazy(() => import('@/pages/privacy'));
const TermsPage = lazy(() => import('@/pages/terms'));
const ExplorePage = lazy(() => import('@/pages/explore'));
const PricingPage = lazy(() => import('@/pages/pricing'));
// TemplatesPage removed — /templates redirects to /explore (Phase 5)
const HelpPage = lazy(() => import('@/pages/help'));
const NotFoundPage = lazy(() => import('@/pages/not-found'));
const LandingPage = lazy(() => import('@/pages/landing'));

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

export function AppRouter() {
  return (
    <Suspense fallback={<PageLoader />}>
      <ScrollToTop />
      <Routes>
        <Route path="/" element={<IndexPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/landing" element={<LandingPage />} />
        <Route path="/pricing" element={<PricingPage />} />
        <Route path="/templates" element={<Navigate to="/explore" replace />} />
        <Route path="/templates/:templateId" element={<Navigate to="/explore" replace />} />
        <Route
          path="/mandalas"
          element={
            <ProtectedRoute>
              <MandalasPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/mandalas/:id/edit"
          element={
            <ProtectedRoute>
              <MandalaSettingsPage />
            </ProtectedRoute>
          }
        />
        <Route path="/mandala-settings" element={<Navigate to="/mandalas" replace />} />
        <Route
          path="/profile"
          element={
            <ProtectedRoute>
              <ProfilePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/settings"
          element={
            <ProtectedRoute>
              <SettingsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/subscription"
          element={
            <ProtectedRoute>
              <SubscriptionPage />
            </ProtectedRoute>
          }
        />
        <Route path="/help" element={<HelpPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route path="/explore" element={<ExplorePage />} />
        <Route path="/explore/:slug" element={<ExplorePage />} />
        {/* Admin Routes */}
        <Route
          path="/admin"
          element={
            <AdminRoute>
              <AdminLayout />
            </AdminRoute>
          }
        >
          <Route index element={<AdminDashboard />} />
          <Route path="users" element={<AdminUsers />} />
          <Route path="analytics" element={<AdminAnalytics />} />
          <Route path="moderation" element={<AdminModeration />} />
          <Route path="promotions" element={<AdminPromotions />} />
          <Route path="payments" element={<AdminPayments />} />
          <Route path="health" element={<AdminHealth />} />
          <Route path="audit-log" element={<AdminAuditLog />} />
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}
