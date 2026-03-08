import { lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
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
const NotFoundPage = lazy(() => import('@/pages/not-found'));

export function AppRouter() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/" element={<IndexPage />} />
        <Route path="/login" element={<LoginPage />} />
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
