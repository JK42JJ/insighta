import { useCallback, useEffect, useRef, useState } from 'react';

import {
  fetchMorningPageCards,
  postFeedJudgment,
  postWatchBatch,
  undoFeedJudgment,
  type FeedHistoryItem,
  type MorningHomePages,
} from '@/features/morning-cards/api';
import { toFeedCard } from '@/features/morning-feed/feed-format';
import { takeWatchStart } from '@/features/morning-feed/watch-prefetch';
import { WatchBoot } from '@/features/morning-feed/WatchBoot';
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
  | { status: 'empty' }
  | {
      status: 'ready';
      cells: FeedCell[];
      today: WatchTodayMap;
      history: FeedHistoryItem[];
      pages: MorningHomePages | null;
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
        const today = parseWatchTodayMap(t.today);
        if (today === null || !Array.isArray(t.cells)) {
          setState({ status: 'error' });
          return;
        }
        const anyGoal = goalCells(t.cells).some(
          (c) => goalChipState(today[c.label]).kind !== 'none'
        );
        setState(
          anyGoal ? { status: 'ready', cells: t.cells, today, history, pages } : { status: 'empty' }
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
      <div className="mf-w" style={MESSAGE_STYLE}>
        오늘 볼 영상이 아직 없습니다
      </div>
    );
  return (
    <MorningWatch
      cells={state.cells}
      today={state.today}
      loadBatch={loadBatch}
      history={state.history}
      pages={state.pages}
      loadPageCards={loadPageCards}
      onJudge={onJudge}
      whenSaved={whenSaved}
      connectYouTube={connectYouTube}
    />
  );
}
