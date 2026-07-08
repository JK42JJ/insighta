import { lazy, Suspense, useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { PageLoader } from '@/shared/ui/PageLoader';
import { ProtectedRoute } from './ProtectedRoute';
import { AdminRoute } from './AdminRoute';
import { MobileGateNotice } from './MobileGateNotice';
import {
  isMobileDevice,
  isPathAllowedOnMobile,
  MOBILE_GATE_FLAG_KEY,
} from '@/shared/lib/mobile-gate';
import { AdminLayout } from '@/pages/admin/ui/AdminLayout';
import { AdminDashboard } from '@/pages/admin/ui/AdminDashboard';
import { AdminUsers } from '@/pages/admin/ui/AdminUsers';
import { AdminPromotions } from '@/pages/admin/ui/AdminPromotions';
import { AdminAuditLog } from '@/pages/admin/ui/AdminAuditLog';
import { AdminAnalytics } from '@/pages/admin/ui/AdminAnalytics';
import { AdminPayments } from '@/pages/admin/ui/AdminPayments';
import { AdminModeration } from '@/pages/admin/ui/AdminModeration';
import { AdminHealth } from '@/pages/admin/ui/AdminHealth';
import { AdminBilling } from '@/pages/admin/ui/AdminBilling';
import { AdminChatbotModels } from '@/pages/admin/ui/AdminChatbotModels';
import { AdminSearchAlgorithms } from '@/pages/admin/ui/AdminSearchAlgorithms';
import { AdminV2QualityAudit } from '@/pages/admin/ui/AdminV2QualityAudit';
import { AdminV4ArbiterRuns } from '@/pages/admin/ui/AdminV4ArbiterRuns';
import { AdminPoolHealth } from '@/pages/admin/ui/AdminPoolHealth';
import { AdminSearchTraceExplorer } from '@/pages/admin/ui/AdminSearchTraceExplorer';

const IndexPage = lazy(() => import('@/pages/index'));
const LoginPage = lazy(() => import('@/pages/login'));
// MandalaSettingsPage moved to -legacy/ in Phase 5 — replaced by MandalaEditorPage
const MandalaWizardPage = lazy(() => import('@/pages/mandala-wizard'));
const MandalaDashboardPage = lazy(() => import('@/pages/mandala-dashboard'));
const MandalaEditorPage = lazy(() => import('@/pages/mandala-editor'));
const MandalasPage = lazy(() => import('@/pages/mandalas'));
const SubscriptionPage = lazy(() => import('@/pages/subscription'));
const BillingSuccessPage = lazy(() => import('@/pages/billing-success'));
const SettingsPage = lazy(() => import('@/pages/settings'));
const PrivacyPage = lazy(() => import('@/pages/privacy'));
const TermsPage = lazy(() => import('@/pages/terms'));
const ExplorePage = lazy(() => import('@/pages/explore'));
const PricingPage = lazy(() => import('@/pages/pricing'));
// Marketing /templates page (CP454): forked from pre-CP453 ExplorePage so the
// public template catalog keeps its scroll-the-grid UX after /explore was
// pivoted to a wizard-style dashboard.
const TemplatesPage = lazy(() => import('@/pages/templates'));
const LearningPage = lazy(() => import('@/pages/learning'));
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
  const { pathname } = useLocation();

  // Closed-beta mobile gate: app routes are desktop-only until the mobile
  // redesign — mobile devices land on the marketing pages instead.
  if (isMobileDevice() && !isPathAllowedOnMobile(pathname)) {
    try {
      sessionStorage.setItem(MOBILE_GATE_FLAG_KEY, '1');
    } catch {
      /* noop */
    }
    return <Navigate to="/landing" replace />;
  }

  return (
    <Suspense fallback={<PageLoader />}>
      <ScrollToTop />
      <MobileGateNotice />
      <Routes>
        <Route path="/" element={<IndexPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/landing" element={<LandingPage />} />
        <Route path="/pricing" element={<PricingPage />} />
        <Route path="/templates" element={<TemplatesPage />} />
        <Route path="/templates/:slug" element={<TemplatesPage />} />
        <Route
          path="/mandalas"
          element={
            <ProtectedRoute>
              <MandalasPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/mandalas/new"
          element={
            <ProtectedRoute>
              <MandalaWizardPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/mandalas/:id/edit"
          element={
            <ProtectedRoute>
              <MandalaEditorPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/mandalas/:id"
          element={
            <ProtectedRoute>
              <MandalaDashboardPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/learning/:mandalaId/:videoId"
          element={
            <ProtectedRoute>
              <LearningPage />
            </ProtectedRoute>
          }
        />
        <Route path="/mandala-settings" element={<Navigate to="/mandalas" replace />} />
        <Route path="/profile" element={<Navigate to="/settings?tab=profile" replace />} />
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
        <Route
          path="/billing/success"
          element={
            <ProtectedRoute>
              <BillingSuccessPage />
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
          <Route path="billing" element={<AdminBilling />} />
          <Route path="health" element={<AdminHealth />} />
          <Route path="audit-log" element={<AdminAuditLog />} />
          <Route path="chatbot-models" element={<AdminChatbotModels />} />
          {/* CP488 — search algorithm catalog + per-mandala override. */}
          <Route path="search-algorithms" element={<AdminSearchAlgorithms />} />
          {/* CP488+ — v2 quality audit daily scan dashboard. */}
          <Route path="v2-quality-audit" element={<AdminV2QualityAudit />} />
          {/* CP489+ — v4 LLM-arbiter PoC runs dashboard (embeds /v4-arbiter-dashboard.html). */}
          <Route path="v4-arbiter-runs" element={<AdminV4ArbiterRuns />} />
          {/* Content Pool Health — 5-section pool dashboard. */}
          <Route path="pool-health" element={<AdminPoolHealth />} />
          {/* Observability G2 — Search-Trace Explorer (Card Journey debug view). */}
          <Route path="search-trace" element={<AdminSearchTraceExplorer />} />
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}
