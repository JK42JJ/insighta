import { useCallback, useEffect, useRef, useState } from 'react';

import {
  fetchMorningPageCards,
  fetchTestClock,
  postFeedJudgment,
  postWatchBatch,
  undoFeedJudgment,
  type FeedHistoryItem,
  type MorningHomePages,
  type TestClockDto,
} from '@/features/morning-cards/api';
import { useAuth } from '@/features/auth/model/useAuth';
import { useLandingArrival } from '@/features/landing-intro';
import { toFeedCard } from '@/features/morning-feed/feed-format';
import { takeWatchStart } from '@/features/morning-feed/watch-prefetch';
import { WatchBoot } from '@/features/morning-feed/WatchBoot';
import { WatchHomeEmpty } from '@/features/morning-feed/WatchHome';
import { TestClockControls } from '@/features/morning-feed/TestClockControls';
import { motionStyleVars } from '@/features/morning-feed/motion-tokens';
import { usePressFeedback } from '@/features/morning-feed/use-press';
import { useAppShell } from '@/features/morning-feed/use-app-shell';
import { useViewportFitCover, useWatchFrame } from '@/features/morning-feed/use-watch-frame';
import { kstDay } from '@/features/morning-feed/watch-design';
import { JudgmentQueue } from '@/features/morning-feed/judgment-queue';
import type { FeedCell } from '@/features/morning-feed/MorningFeed';
import fixture from '@/features/morning-feed/morning-feed.fixture.json';
import {
  MorningWatch,
  type WatchBatchView,
  type WatchJudgeEvent,
} from '@/features/morning-feed/MorningWatch';
import {
  goalCells,
  goalChipState,
  parseWatchTodayMap,
  type WatchTodayMap,
  type WatchVerdict,
  type WatchVideo,
} from '@/features/morning-feed/watch-list';
import {
  fetchYouTubeAuthStatus,
  useYouTubeConnect,
} from '@/features/youtube-sync/model/useYouTubeAuth';
import './watch.css';

const PALETTE = (fixture.cards as Array<{ bg: string }>).map((c) => c.bg);
/** How often the queue is checked before the insight is read. */
const SAVE_POLL_MS = 200;
/** The insight is read after this long even if a write is still pending (it is retried later). */
const SAVE_WAIT_MAX_MS = 4000;

type LoadState =
  | { status: 'loading' }
  | { status: 'error' }
  /**
   * No readable brief (brief = a participant; the experiment's empty state otherwise), shown in
   * the home's layout. day = the server's today, for the home's date row.
   */
  | { status: 'empty'; brief?: boolean; day?: string }
  | {
      status: 'ready';
      cells: FeedCell[];
      today: WatchTodayMap;
      history: FeedHistoryItem[];
      pages: MorningHomePages | null;
      /** /watch/today's day: the KST day, or the virtual day on stg. */
      day: string | undefined;
      /** The main account's experiment UI (decision 2026-11-14 user test). */
      experiment: boolean;
    };

const MESSAGE_STYLE = {
  position: 'fixed',
  inset: 0,
  display: 'grid',
  placeItems: 'center',
  background: 'var(--w-paper)',
  color: 'var(--w-sub)',
  font: '500 15px var(--w-font)',
} as const;

const WATCH_SURFACE = 'watch';

/**
 * Live data for the watch screen: the goals and their state today from GET /watch/today, each
 * goal's videos from its daily batch (POST /watch/batch), and the deck's judgment write queue with
 * surface 'watch' on every judgment so only this screen's answers count here.
 */
export function MorningWatchLive(): JSX.Element {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  // signed in from the landing: no onboarding; its events and the ADD notice once a screen shows
  useLandingArrival(state.status !== 'loading');
  const queue = useRef<JudgmentQueue | null>(null);
  if (queue.current === null) {
    queue.current = new JudgmentQueue({
      send: (op) => (op.kind === 'judge' ? postFeedJudgment(op.body) : undoFeedJudgment()),
    });
  }

  useEffect(() => {
    let alive = true;
    takeWatchStart()
      .then(([t, history, pages]) => {
        if (!alive) return;
        if (t === null) {
          // a participant: the shared briefs only
          setState(
            pages?.current && pages.cells
              ? {
                  status: 'ready',
                  cells: pages.cells,
                  today: {},
                  history: [],
                  pages,
                  day: pages.today,
                  experiment: false,
                }
              : { status: 'empty', brief: true, day: pages?.today }
          );
          return;
        }
        const today = parseWatchTodayMap(t.today);
        if (today === null || !Array.isArray(t.cells)) {
          setState({ status: 'error' });
          return;
        }
        const anyGoal = goalCells(t.cells).some(
          (c) => goalChipState(today[c.label]).kind !== 'none'
        );
        // a readable brief (the newest up to today, server-picked) opens the home even when no
        // goal has videos today
        setState(
          anyGoal || !!pages?.current
            ? {
                status: 'ready',
                cells: t.cells,
                today,
                history,
                pages,
                day: t.day,
                experiment: pages?.experiment !== false,
              }
            : { status: 'empty', day: pages?.today ?? t.day }
        );
      })
      .catch(() => alive && setState({ status: 'error' }));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const q = queue.current;
    const flush = () => void q?.flush();
    window.addEventListener('online', flush);
    document.addEventListener('visibilitychange', flush);
    void q?.flush(); // anything left from a previous session
    return () => {
      window.removeEventListener('online', flush);
      document.removeEventListener('visibilitychange', flush);
    };
  }, []);

  const onJudge = useCallback((e: WatchJudgeEvent) => {
    if (!e.video.videoId) return;
    queue.current?.enqueue({
      kind: 'judge',
      body: {
        video_id: e.video.videoId,
        cell: e.video.cell,
        verdict: e.verdict,
        shown_position: e.shownPosition,
        surface: WATCH_SURFACE,
      },
    });
  }, []);

  const loadBatch = useCallback(async (cellLabel: string): Promise<WatchBatchView> => {
    const batch = await postWatchBatch(cellLabel);
    const items: WatchVideo[] = batch.items.map((c) => ({
      ...toFeedCard(c, PALETTE),
      durationSec: c.duration,
    }));
    const judged: Record<string, WatchVerdict> = { ...batch.judged };
    return { items, judged };
  }, []);

  const loadPageCards = useCallback(async (cellLabel: string, date: string) => {
    const res = await fetchMorningPageCards(cellLabel, date);
    if (!res) return null;
    const items: WatchVideo[] = res.items.map((c) => ({
      ...toFeedCard(c, PALETTE),
      durationSec: c.duration,
    }));
    const judged: Record<string, WatchVerdict> = { ...res.judged };
    return { items, judged };
  }, []);

  const whenSaved = useCallback(
    () =>
      new Promise<void>((resolve) => {
        const started = Date.now();
        const check = () => {
          const pending = queue.current?.size ?? 0;
          if (pending === 0 || Date.now() - started >= SAVE_WAIT_MAX_MS) resolve();
          else window.setTimeout(check, SAVE_POLL_MS);
        };
        check();
      }),
    []
  );

  // 01 온보딩 step 3: the app's existing YouTube OAuth flow (settings YouTube tab, same edge
  // function). Already connected -> nothing to do. Any failure (popup blocked, declined, timeout)
  // ends the onboarding as well; the account can be connected later in settings.
  const { mutateAsync: connectMutate } = useYouTubeConnect();
  const connectYouTube = useCallback(async (): Promise<void> => {
    try {
      if ((await fetchYouTubeAuthStatus()).isConnected) return;
    } catch {
      /* status unknown: try the connection */
    }
    try {
      await connectMutate();
    } catch {
      /* not connected: the onboarding still ends */
    }
  }, [connectMutate]);

  if (state.status === 'loading') return <WatchBoot />;
  if (state.status === 'error')
    return (
      <div className="mf-w" style={MESSAGE_STYLE}>
        영상을 불러오지 못했습니다
      </div>
    );
  if (state.status === 'empty')
    return (
      <EmptyHome
        day={state.day}
        message={state.brief ? '아직 준비된 브리프가 없습니다' : '오늘 볼 영상이 아직 없습니다'}
      />
    );
  return (
    <MorningWatch
      cells={state.cells}
      today={state.today}
      loadBatch={loadBatch}
      history={state.history}
      pages={state.pages}
      serverDay={state.day}
      loadPageCards={loadPageCards}
      onJudge={onJudge}
      whenSaved={whenSaved}
      connectYouTube={connectYouTube}
      experiment={state.experiment}
    />
  );
}

/**
 * No readable brief: the empty-state text inside the home's layout (top bar with the account,
 * the date row), as an app screen like the home itself. The stg test clock stays reachable from
 * the account sheet, so a virtual day without a brief can be moved back.
 */
function EmptyHome({ day, message }: { day?: string; message: string }): JSX.Element {
  useViewportFitCover();
  useAppShell();
  const { userName, userEmail, userAvatar, signOut } = useAuth();
  const app = useRef<HTMLDivElement>(null);
  const frame = useWatchFrame(app);
  usePressFeedback(app);
  const [clock, setClock] = useState<TestClockDto | null>(null);
  useEffect(() => {
    let on = true;
    fetchTestClock()
      .then((c) => on && setClock(c))
      .catch(() => undefined);
    return () => {
      on = false;
    };
  }, []);
  const [now] = useState(() => new Date());
  return (
    <div className="mf-w">
      <div
        ref={app}
        className="mf-w-app"
        lang="ko"
        data-testid="mf-watch-root"
        style={motionStyleVars()}
      >
        <WatchHomeEmpty
          frame={frame}
          today={day ?? kstDay(now)}
          message={message}
          account={{
            name: userName ?? '',
            email: userEmail ?? '',
            avatarUrl: userAvatar,
            onLogout: () => void signOut(),
            extra: clock ? <TestClockControls clock={clock} /> : undefined,
          }}
        />
      </div>
    </div>
  );
}
