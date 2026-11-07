import '@/features/morning-feed/fonts';

import { useEffect, useMemo, useRef, useState } from 'react';

import { fetchMorningFeed, postFeedJudgment, undoFeedJudgment } from '@/features/morning-cards/api';
import { toFeedCard } from '@/features/morning-feed/feed-format';
import { JudgmentQueue } from '@/features/morning-feed/judgment-queue';
import { MorningFeed, type FeedCard, type FeedCell } from '@/features/morning-feed/MorningFeed';
import fixture from '@/features/morning-feed/morning-feed.fixture.json';

const PALETTE = (fixture.cards as Array<{ bg: string }>).map((c) => c.bg);

type LoadState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'empty' }
  | { status: 'ready'; cards: FeedCard[]; grid: FeedCell[] };

const MESSAGE_STYLE = {
  position: 'fixed',
  inset: 0,
  display: 'grid',
  placeItems: 'center',
  background: 'var(--mf-page)',
  color: 'var(--mf-muted)',
  font: "500 15px -apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif",
} as const;

/**
 * Live mode: the signed-in test account's cards from the feed API. Judgments go through a
 * write queue so the screen never waits on the network.
 */
export function MorningFeedLive() {
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
        const cards = feed.cards.map((c) => toFeedCard(c, PALETTE));
        setState(
          cards.length === 0 ? { status: 'empty' } : { status: 'ready', cards, grid: feed.cells }
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

  const onJudge = useMemo(
    () =>
      (cards: FeedCard[]) =>
      (e: { index: number; verdict: 'useful' | 'skip' | 'pass'; shownPosition: number }) => {
        const card = cards[e.index];
        if (!card?.videoId) return;
        queue.current?.enqueue({
          kind: 'judge',
          body: {
            video_id: card.videoId,
            cell: card.cell,
            verdict: e.verdict,
            shown_position: e.shownPosition,
          },
        });
      },
    []
  );

  if (state.status === 'loading') return <div style={MESSAGE_STYLE} />;
  if (state.status === 'error') return <div style={MESSAGE_STYLE}>영상을 불러오지 못했어요</div>;
  if (state.status === 'empty') return <div style={MESSAGE_STYLE}>오늘 볼 영상이 아직 없어요</div>;
  return (
    <MorningFeed
      cards={state.cards}
      grid={state.grid}
      onJudge={onJudge(state.cards)}
      onUndo={() => queue.current?.enqueue({ kind: 'undo' })}
    />
  );
}
