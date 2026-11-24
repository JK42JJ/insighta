import { useEffect, useMemo, useState } from 'react';

import type { WatchVerdict, WatchVideo } from '@/features/morning-feed/watch-list';
import { WatchFeed, type R3Reaction, type R3Verdict } from '@/features/morning-feed/watch-r3-feed';
import type { Frame } from '@/features/morning-feed/watch-r3-layout';
import { MOTION } from '@/features/morning-feed/motion-tokens';
import { r3VideoOf } from '@/features/morning-feed/watch-r3-video';
import { WatchPlayer, type PlayerController } from '@/features/morning-feed/WatchPlayer';
import './page-watch.css';

/*
 * A page's videos in the watch screen (decision 2026-11-14, step 1): the page's whole video list
 * in its order, starting at the tapped video (at the source's second when it has one), moved
 * through up and down with the same cards and player as the daily watch screen. Swiping on
 * records nothing; 좋아/별로 are recorded as on the watch screen. The page stays mounted under
 * this layer, so its scroll position and the note's open state are kept. The slide in and out
 * is PageWithWatch's.
 */

export interface PageWatchCards {
  items: WatchVideo[];
  judged: Record<string, WatchVerdict>;
}

export interface PageWatchProps {
  frame: Frame & { width: number };
  goalTitle: string;
  load: () => Promise<PageWatchCards | null>;
  /** The tapped video and second (0 = from the start). */
  start: { videoId: string; t: number };
  sound: boolean;
  onSound: (on: boolean) => void;
  onJudge: (video: WatchVideo, verdict: WatchVerdict, index: number) => void;
  /** The back button or the end of the list. */
  onClose: () => void;
}

const REACTION_OF: Record<WatchVerdict, R3Reaction> = {
  useful: 'like',
  skip: 'dislike',
  pass: 'skip',
};
const VERDICT_OF: Record<R3Verdict, WatchVerdict> = {
  useful: 'useful',
  skip: 'skip',
  pass: 'pass',
};
/** The slide-in (PageWithWatch); the feed and its player start only after it, never mid-slide. */
const SLIDE_MS = MOTION.push.ms;

export function PageWatch(p: PageWatchProps): JSX.Element {
  const [cards, setCards] = useState<PageWatchCards | null>(null);
  const [player] = useState<{ current: PlayerController | null }>(() => ({ current: null }));
  // YouTube: no automatic playback before more than half of the player is visible. The layer
  // slides in from the right, so the feed (and so the player) is mounted once it is in place.
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setEntered(true), SLIDE_MS);
    return () => window.clearTimeout(t);
  }, []);
  useEffect(() => {
    let on = true;
    p.load()
      .then((c) => {
        if (!on) return;
        if (!c || c.items.length === 0) p.onClose();
        else setCards(c);
      })
      .catch(() => on && p.onClose());
    return () => {
      on = false;
    };
    // one load per open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const videos = useMemo(() => (cards?.items ?? []).map(r3VideoOf), [cards]);
  const startIdx = Math.max(0, cards?.items.findIndex((v) => v.videoId === p.start.videoId) ?? 0);
  return (
    <div className="mf-pw-body" data-testid="mf-page-watch">
      {cards && entered ? (
        <WatchFeed
          goalTitle={p.goalTitle}
          videos={videos}
          frame={p.frame}
          loading={false}
          recordPass={false}
          startSeconds={p.start.t}
          initial={{
            idx: startIdx,
            maxIdx: startIdx,
            reacts: cards.items.map((v) => {
              const j = v.videoId ? cards.judged[v.videoId] : undefined;
              return j ? REACTION_OF[j] : (undefined as unknown as R3Reaction);
            }),
          }}
          onVerdict={(i, v) => {
            const video = cards.items[i];
            // swiping on is never recorded here (recordPass false): only 좋아/별로 arrive
            if (video && v !== 'pass') p.onJudge(video, VERDICT_OF[v], i);
          }}
          onFinish={p.onClose}
          onBack={p.onClose}
          sound={p.sound}
          onSound={p.onSound}
          player={player}
          renderPlayer={(events) => (
            <WatchPlayer
              controller={player}
              onReady={events.onReady}
              onPlaying={events.onPlaying}
              onMuted={events.onMuted}
              onTick={events.onTick}
              onFailed={events.onFailed}
            />
          )}
        />
      ) : (
        <div className="mf-w3-root" data-testid="mf-page-watch-wait" />
      )}
    </div>
  );
}
