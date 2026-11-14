import { useCallback, useEffect, useRef, useState } from 'react';

import type { WatchVerdict, WatchVideo } from '@/features/morning-feed/watch-list';
import { PageWatch, type PageWatchCards } from '@/features/morning-feed/PageWatch';
import { WatchPage, type WatchPageProps } from '@/features/morning-feed/WatchPage';

/*
 * 한 장 with its videos one tap away (decision 2026-11-14, step 1). Opening pushes one history
 * entry, so the browser's back (and Safari's edge swipe, which is a history back) returns to the
 * page. A history back closes the layer at once: Safari already draws its own transition for the
 * edge swipe, and a second slide of ours would move the screen twice. The back button goes
 * through history.back() too, so the history stays one entry deep.
 */

export interface PageWithWatchProps extends Omit<WatchPageProps, 'onOpenVideo'> {
  loadCards: () => Promise<PageWatchCards | null>;
  sound: boolean;
  onSound: (on: boolean) => void;
  onJudge: (video: WatchVideo, verdict: WatchVerdict, index: number) => void;
}

const HISTORY_KEY = 'mfPageWatch';

export function PageWithWatch({
  loadCards,
  sound,
  onSound,
  onJudge,
  ...page
}: PageWithWatchProps): JSX.Element {
  const [watch, setWatch] = useState<{ videoId: string; t: number; key: number } | null>(null);
  const pushed = useRef(false);
  const seq = useRef(0);

  useEffect(() => {
    const onPop = (): void => {
      if (!pushed.current) return;
      pushed.current = false;
      setWatch(null);
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      // leaving the page while the layer is open: drop our history entry
      if (pushed.current) {
        pushed.current = false;
        window.history.back();
      }
    };
  }, []);

  const open = useCallback((videoId: string, t: number) => {
    seq.current += 1;
    setWatch({ videoId, t, key: seq.current });
    if (!pushed.current) {
      window.history.pushState({ [HISTORY_KEY]: true }, '');
      pushed.current = true;
    }
  }, []);
  const close = useCallback(() => {
    if (pushed.current) window.history.back();
    else setWatch(null);
  }, []);

  return (
    <div className="mf-pw-host" data-testid="mf-page-host">
      <WatchPage {...page} onOpenVideo={open} />
      {watch ? (
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
      ) : null}
    </div>
  );
}
