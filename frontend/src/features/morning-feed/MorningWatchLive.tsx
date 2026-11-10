import '@/features/morning-feed/fonts';

import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchMorningFeed, postFeedJudgment, undoFeedJudgment } from '@/features/morning-cards/api';
import { toFeedCard } from '@/features/morning-feed/feed-format';
import { JudgmentQueue } from '@/features/morning-feed/judgment-queue';
import type { FeedCell } from '@/features/morning-feed/MorningFeed';
import fixture from '@/features/morning-feed/morning-feed.fixture.json';
import { MorningWatch, type WatchJudgeEvent } from '@/features/morning-feed/MorningWatch';
import { parseWatchDaily, type WatchVideo } from '@/features/morning-feed/watch-list';

const PALETTE = (fixture.cards as Array<{ bg: string }>).map((c) => c.bg);
/** How often the queue is checked before the insight is read. */
const SAVE_POLL_MS = 200;
/** The insight is read after this long even if a write is still pending (it is retried later). */
const SAVE_WAIT_MAX_MS = 4000;

type LoadState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'empty' }
  | { status: 'ready'; cards: WatchVideo[]; cells: FeedCell[]; daily: number };

const MESSAGE_STYLE = {
  position: 'fixed',
  inset: 0,
  display: 'grid',
  placeItems: 'center',
  background: 'var(--mf-page)',
  color: 'var(--mf-muted)',
  font: "500 15px 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif",
} as const;

/**
 * Live data for the watch screen: the same feed API and the same judgment write queue as the
 * deck (POST /judgments body is identical). The number of videos per day comes from the server.
 */
export function MorningWatchLive() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const queue = useRef<JudgmentQueue | null>(null);
  if (queue.current === null) {
    queue.current = new JudgmentQueue({
      send: (op) => (op.kind === 'judge' ? postFeedJudgment(op.body) : undoFeedJudgment()),
    });
  }

  useEffect(() => {
    let alive = true;
    fetchMorningFeed()
      .then((feed) => {
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
            : { status: 'ready', cards, cells: feed.cells, daily }
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

  if (state.status === 'loading') return <div className="mf-page mf-watch" style={MESSAGE_STYLE} />;
  if (state.status === 'error')
    return (
      <div className="mf-page mf-watch" style={MESSAGE_STYLE}>
        영상을 불러오지 못했습니다
      </div>
    );
  if (state.status === 'empty')
    return (
      <div className="mf-page mf-watch" style={MESSAGE_STYLE}>
        오늘 볼 영상이 아직 없습니다
      </div>
    );
  return (
    <MorningWatch
      cards={state.cards}
      cells={state.cells}
      daily={state.daily}
      onJudge={onJudge}
      whenSaved={whenSaved}
    />
  );
}
