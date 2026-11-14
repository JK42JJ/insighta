import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import type { WatchVerdict, WatchVideo } from '@/features/morning-feed/watch-list';
import { MOTION, prefersReducedMotion } from '@/features/morning-feed/motion-tokens';
import { PageWatch, type PageWatchCards } from '@/features/morning-feed/PageWatch';
import { popIsNative, trackEdgeSwipe } from '@/features/morning-feed/use-screen-history';
import { WatchPage, type WatchPageProps } from '@/features/morning-feed/WatchPage';

/*
 * A brief with its videos one tap away (decision 2026-11-14). Opening pushes one history entry,
 * so the browser's back (and Safari's edge swipe, which is a history back) returns to the brief.
 * Motion (decision 2026-11-14 "앱처럼 반응", values in motion-tokens.ts): the video screen slides
 * in from the right while the brief moves 30 % left and darkens; going back is exactly the
 * reverse. A back the browser animates itself (Safari's edge swipe) closes at once, so the
 * screen never moves twice. The back button goes through history.back() too, so the history
 * stays one entry deep. The brief stays mounted under the layer (scroll and note kept).
 */

export interface PageWithWatchProps extends Omit<WatchPageProps, 'onOpenVideo'> {
  loadCards: () => Promise<PageWatchCards | null>;
  sound: boolean;
  onSound: (on: boolean) => void;
  onJudge: (video: WatchVideo, verdict: WatchVerdict, index: number) => void;
  /** A source link or an evidence row was opened (usage count). */
  onEvidence?: (videoId: string) => void;
}

const HISTORY_KEY = 'mfPageWatch';

export function PageWithWatch({
  loadCards,
  sound,
  onSound,
  onJudge,
  onEvidence,
  ...page
}: PageWithWatchProps): JSX.Element {
  const [watch, setWatch] = useState<{ videoId: string; t: number; key: number } | null>(null);
  /** 'in' while sliding in, 'out' while sliding back; null at rest. */
  const [phase, setPhase] = useState<'in' | 'out' | null>(null);
  const pushed = useRef(false);
  const seq = useRef(0);
  const under = useRef<HTMLDivElement>(null);
  const dim = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const anims = useRef<Animation[]>([]);

  const slide = useCallback((dir: 'in' | 'out'): Promise<void> => {
    anims.current.forEach((a) => a.cancel());
    anims.current = [];
    const { ms, ease, underShift, underDim } = MOTION.push;
    const o: KeyframeAnimationOptions = { duration: ms, easing: ease, fill: 'both' };
    const shift = `translate3d(${-underShift * 100}%,0,0)`;
    const run = (el: HTMLElement | null, kf: Keyframe[]): void => {
      if (el && typeof el.animate === 'function') anims.current.push(el.animate(kf, o));
    };
    const rev = <T,>(a: T[]): T[] => (dir === 'in' ? a : a.slice().reverse());
    if (prefersReducedMotion()) {
      run(layer.current, rev([{ opacity: 0 }, { opacity: 1 }]));
    } else {
      run(
        layer.current,
        rev([{ transform: 'translate3d(100%,0,0)' }, { transform: 'translate3d(0,0,0)' }])
      );
      run(under.current, rev([{ transform: 'translate3d(0,0,0)' }, { transform: shift }]));
      run(dim.current, rev([{ opacity: 0 }, { opacity: underDim }]));
    }
    const list = anims.current;
    return Promise.all(list.map((a) => a.finished.catch(() => undefined))).then(() => {
      list.forEach((a) => a.cancel());
    });
  }, []);

  const closeNow = useCallback(() => {
    anims.current.forEach((a) => a.cancel());
    anims.current = [];
    setPhase(null);
    setWatch(null);
  }, []);

  useEffect(() => {
    const stopEdge = trackEdgeSwipe();
    const onPop = (e: PopStateEvent): void => {
      if (!pushed.current) return;
      pushed.current = false;
      if (popIsNative(e)) {
        closeNow();
        return;
      }
      setPhase('out');
    };
    window.addEventListener('popstate', onPop);
    return () => {
      stopEdge();
      window.removeEventListener('popstate', onPop);
      // leaving the brief while the layer is open: drop our history entry
      if (pushed.current) {
        pushed.current = false;
        window.history.back();
      }
    };
  }, [closeNow]);

  // the slides run once the layer is drawn
  useLayoutEffect(() => {
    if (phase === 'in') {
      void slide('in').then(() => setPhase((p) => (p === 'in' ? null : p)));
    } else if (phase === 'out') {
      void slide('out').then(() => {
        setPhase(null);
        setWatch(null);
      });
    }
  }, [phase, slide]);

  const open = useCallback(
    (videoId: string, t: number) => {
      seq.current += 1;
      setWatch({ videoId, t, key: seq.current });
      setPhase('in');
      onEvidence?.(videoId);
      if (!pushed.current) {
        window.history.pushState({ [HISTORY_KEY]: true }, '');
        pushed.current = true;
      }
    },
    [onEvidence]
  );
  const close = useCallback(() => {
    if (pushed.current) window.history.back();
    else closeNow();
  }, [closeNow]);

  return (
    <div className="mf-pw-host" data-testid="mf-page-host" data-phase={phase ?? undefined}>
      <div
        ref={under}
        className="mf-pw-under"
        data-covered={watch && !phase ? '' : undefined}
        aria-hidden={watch ? true : undefined}
      >
        <WatchPage {...page} onOpenVideo={open} />
        <div ref={dim} className="mf-stack-dim" />
      </div>
      {watch ? (
        <div ref={layer} className="mf-pw" data-testid="mf-page-watch-layer">
          <PageWatch
            key={watch.key}
            frame={page.frame}
            goalTitle={page.domainTitle}
            load={loadCards}
            start={{ videoId: watch.videoId, t: watch.t }}
            sound={sound}
            onSound={onSound}
            onJudge={onJudge}
            onClose={close}
          />
        </div>
      ) : null}
    </div>
  );
}
