import { Suspense } from 'react';
import { useLocation } from 'react-router-dom';

import { useAuthContext } from '@/features/auth/model/AuthContext';
import { lazyScreen } from '@/features/morning-feed/first-load';
import { returnPathOf } from '@/features/morning-feed/brief-address';
import { isDeckView } from '@/features/morning-feed/morning-view';
import { parseFixtureScreen } from '@/features/morning-feed/fixture-screen';
import { WatchBoot } from '@/features/morning-feed/WatchBoot';

import { AUTH_RETURN_KEY } from './mobile-auth-return';
import { ProtectedRoute } from './ProtectedRoute';

const MorningFeedRoute = lazyScreen(() =>
  import('@/features/morning-feed/MorningFeedRoute').then((m) => ({ default: m.MorningFeedRoute }))
);
const MorningWatchFixture = lazyScreen(() =>
  import('@/features/morning-feed/MorningWatchFixture').then((m) => ({
    default: m.MorningWatchFixture,
  }))
);
const MorningWatchR3Fixture = lazyScreen(() =>
  import('@/features/morning-feed/MorningWatchR3Fixture').then((m) => ({
    default: m.MorningWatchR3Fixture,
  }))
);
const IntroPage = lazyScreen(() => import('@/pages/intro'));
const MorningFeedFixture = lazyScreen(() =>
  import('@/features/morning-feed/MorningFeedFixture').then((m) => ({
    default: m.MorningFeedFixture,
  }))
);

/**
 * /morning-cards entry. `?fixture=1` shows the design test-hook screen (fixed cards,
 * no sign-in needed); with `&view=watch` the watch flow's test-hook screen (the mobile design
 * handoff's example data, `&screen=onb|input|watch|insight`; with `&preset=` the 수정 3 handoff's
 * presets, `&safe=47,34` and `&thumbs=` optional). Otherwise (plain or
 * `?view=watch`) the watch screen, the landing page when signed out; the swipe deck (오늘의 픽) only
 * at `?view=deck`, signed in and flag-gated. The earlier judging screen stays at /morning-cards/classic.
 */
export function MorningCardsEntry() {
  const { search } = useLocation();
  const q = new URLSearchParams(search);
  if (q.get('fixture') === '1' && q.get('view') === 'watch' && q.get('preset') !== null) {
    // 수정 3 design: the handoff's presets on the real screens (side-by-side captures)
    return (
      <Suspense fallback={null}>
        <MorningWatchR3Fixture
          preset={q.get('preset')}
          safe={q.get('safe')}
          thumbs={q.get('thumbs')}
          real={q.get('real') === '1'}
        />
      </Suspense>
    );
  }
  if (q.get('fixture') === '1' && q.get('view') === 'watch') {
    return (
      <Suspense fallback={null}>
        <MorningWatchFixture screen={parseFixtureScreen(q.get('screen'))} />
      </Suspense>
    );
  }
  if (q.get('fixture') === '1') {
    return (
      <Suspense fallback={null}>
        <MorningFeedFixture />
      </Suspense>
    );
  }
  if (!isDeckView(search)) return <WatchEntry />;
  return (
    <ProtectedRoute>
      <Suspense fallback={null}>
        <MorningFeedRoute />
      </Suspense>
    </ProtectedRoute>
  );
}

/**
 * The participant address: signed out -> the landing page (decision 2026-11-24), signed in -> the
 * watch screen as before. The watch screen's first-open screen shows while either starts. After
 * Google sign-in: today's brief screen (decision 2026-11-24), or the brief whose shared address
 * this is (order 2026-11-25 B8).
 */
function WatchEntry(): JSX.Element {
  const { user, isLoading, signInWithGoogle } = useAuthContext();
  const { search } = useLocation();
  if (isLoading) return <WatchBoot logoOnly />;
  if (!user) {
    const signIn = async (): Promise<void> => {
      try {
        sessionStorage.setItem(AUTH_RETURN_KEY, returnPathOf(search));
      } catch {
        /* storage blocked: the return lands on / */
      }
      await signInWithGoogle();
    };
    return (
      <Suspense fallback={<WatchBoot />}>
        <IntroPage onSignIn={signIn} />
      </Suspense>
    );
  }
  return (
    <Suspense fallback={<WatchBoot />}>
      <MorningFeedRoute />
    </Suspense>
  );
}
