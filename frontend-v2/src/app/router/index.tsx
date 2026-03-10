import { lazy, Suspense, useEffect } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import { PageLoader } from '@/shared/ui/PageLoader';

const IndexPage = lazy(() => import('@/pages/index'));
const LoginPage = lazy(() => import('@/pages/login'));
const MandalaSettingsPage = lazy(() => import('@/pages/mandala-settings'));
const ProfilePage = lazy(() => import('@/pages/profile'));
const SubscriptionPage = lazy(() => import('@/pages/subscription'));
const SettingsPage = lazy(() => import('@/pages/settings'));
const PrivacyPage = lazy(() => import('@/pages/privacy'));
const TermsPage = lazy(() => import('@/pages/terms'));
const ExplorePage = lazy(() => import('@/pages/explore'));
const PricingPage = lazy(() => import('@/pages/pricing'));
const TemplatesPage = lazy(() => import('@/pages/templates'));
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
        <Route path="/templates" element={<TemplatesPage />} />
        <Route path="/templates/:templateId" element={<TemplatesPage />} />
        <Route path="/mandala-settings" element={<MandalaSettingsPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/subscription" element={<SubscriptionPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route path="/explore" element={<ExplorePage />} />
        <Route path="/explore/:slug" element={<ExplorePage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}
