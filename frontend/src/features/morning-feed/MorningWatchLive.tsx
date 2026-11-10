import { useCallback, useEffect, useRef, useState } from 'react';

import {
  fetchMorningFeed,
  fetchMorningFeedHistory,
  postFeedJudgment,
  undoFeedJudgment,
  type FeedHistoryItem,
} from '@/features/morning-cards/api';
import { toFeedCard } from '@/features/morning-feed/feed-format';
import { JudgmentQueue } from '@/features/morning-feed/judgment-queue';
import type { FeedCell } from '@/features/morning-feed/MorningFeed';
import fixture from '@/features/morning-feed/morning-feed.fixture.json';
import { MorningWatch, type WatchJudgeEvent } from '@/features/morning-feed/MorningWatch';
import {
  parseWatchDaily,
  parseWatchToday,
  type WatchToday,
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
      cards: WatchVideo[];
      cells: FeedCell[];
      daily: number;
      watchToday: WatchToday | null;
      history: FeedHistoryItem[];
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

/**
 * Live data for the watch screen: the same feed API and the same judgment write queue as the
 * deck (POST /judgments body is identical). The number of videos per day and today's judged count
 * per goal come from the server (a server without the count: no per-goal limit, as before).
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
    // 이전 주제 is optional: when it cannot be read the section is simply not drawn
    const historyP = fetchMorningFeedHistory().catch((): FeedHistoryItem[] => []);
    Promise.all([fetchMorningFeed(), historyP])
      .then(([feed, history]) => {
        if (!alive) return;
        const daily = parseWatchDaily(feed.watch_daily);
        if (daily === null) {
          setState({ status: 'error' });
          return;
        }
        const cards: WatchVideo[] = feed.cards.map((c) => ({
          ...toFeedCard(c, PALETTE),
          durationSec: c.duration,
        }));
        setState(
          cards.length === 0
            ? { status: 'empty' }
            : {
                status: 'ready',
                cards,
                cells: feed.cells,
                daily,
                watchToday: parseWatchToday(feed.watch_today),
                history,
              }
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
      },
    });
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

  if (state.status === 'loading') return <div className="mf-w" style={MESSAGE_STYLE} />;
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
      cards={state.cards}
      cells={state.cells}
      daily={state.daily}
      watchToday={state.watchToday}
      history={state.history}
      onJudge={onJudge}
      whenSaved={whenSaved}
      connectYouTube={connectYouTube}
    />
  );
}
