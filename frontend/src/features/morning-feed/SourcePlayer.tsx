import { useEffect, useRef, useState } from 'react';

import { PlaySeconds } from '@/features/morning-feed/play-seconds';
import { useWatchReporter, YT_STATE_PLAYING } from '@/features/morning-feed/use-watch-reporter';
import { loadYouTubeApi, type YtPlayer } from '@/features/morning-feed/youtube-iframe-api';

/*
 * The source sheet's one YouTube player: the same iframe for every source tapped while the sheet
 * is open. It starts with sound at the source's second. When the browser refuses that (iPhone),
 * the video is left cued, so YouTube's own play button shows; it is never started muted instead.
 * Nothing is drawn over it.
 */

export interface SourceTarget {
  videoId: string;
  t: number;
  /** Changes with every tap on a source (the same source tapped again plays from its second). */
  key: number;
}

export interface SourcePlayerHandle {
  /** Stops playing for good (the sheet is going away) and reports the seconds played. */
  stop: () => void;
  /** Where the shown video is; null = it has not played yet. */
  position: () => number | null;
}

interface Props {
  target: SourceTarget;
  handle: { current: SourcePlayerHandle | null };
  /** Whole seconds a video played (after it was switched, closed, or the page was hidden). */
  onWatched: (videoId: string, seconds: number) => void;
}

export function SourcePlayer({ target, handle, onWatched }: Props): JSX.Element {
  const host = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const want = useRef(target);
  const apply = useRef<((t: SourceTarget) => void) | null>(null);
  const watched = useRef(onWatched);
  watched.current = onWatched;
  const { reporter, positionRef } = useWatchReporter(target.videoId);

  useEffect(() => {
    want.current = target;
    apply.current?.(target);
    // a new tap is a new key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.key]);

  useEffect(() => {
    let alive = true;
    let instance: YtPlayer | null = null;
    /** The target the player was given last. */
    let loaded: SourceTarget | null = null;
    let played = false;
    let blocked = false;
    let stopped = false;
    const seconds = new PlaySeconds();
    const report = (n: number): void => {
      if (loaded && n > 0) watched.current(loaded.videoId, n);
    };
    const mount = document.createElement('div');
    host.current?.appendChild(mount);

    const start = (p: YtPlayer, t: SourceTarget): void => {
      report(seconds.end());
      loaded = t;
      played = false;
      const at = { videoId: t.videoId, startSeconds: Math.max(0, t.t) };
      // refused once and not played since: it would be refused again, the play button shows
      if (blocked) p.cueVideoById(at);
      else p.loadVideoById(at);
    };

    loadYouTubeApi()
      .then((yt) => {
        if (!alive) return;
        const first = want.current;
        loaded = first;
        instance = new yt.Player(mount, {
          width: '100%',
          height: '100%',
          videoId: first.videoId,
          playerVars: {
            playsinline: 1,
            rel: 0,
            controls: 1,
            autoplay: 0,
            start: Math.max(0, Math.floor(first.t)),
            origin: window.location.origin,
          },
          events: {
            onReady: (e) => {
              // closed before it was ready: it does not start while the sheet slides away
              if (!alive || stopped) return;
              const p = e.target;
              positionRef.current = () => p.getCurrentTime();
              // YouTube remembers the muted state of the video screen's player
              p.unMute();
              apply.current = (t) => {
                if (alive && loaded?.key !== t.key) start(p, t);
              };
              if (want.current.key !== first.key) start(p, want.current);
              else p.playVideo();
            },
            onError: () => undefined, // YouTube says so in the player itself
            onStateChange: (e) => {
              if (!alive) return;
              if (e.data === YT_STATE_PLAYING) {
                played = true;
                blocked = false;
              }
              seconds.onState(e.data);
              reporter.onState(e.data);
            },
            onAutoplayBlocked: () => {
              if (!alive || !instance || !loaded) return;
              blocked = true;
              instance.cueVideoById({
                videoId: loaded.videoId,
                startSeconds: Math.max(0, loaded.t),
              });
            },
          },
        });
      })
      .catch(() => alive && setFailed(true));

    const stop = (): void => {
      stopped = true;
      report(seconds.end());
      try {
        instance?.pauseVideo?.();
      } catch {
        /* not ready or already gone */
      }
    };
    handle.current = {
      stop,
      position: () => {
        if (!played) return null;
        try {
          return instance?.getCurrentTime() ?? null;
        } catch {
          return null;
        }
      },
    };
    const onHide = (): void => {
      if (document.visibilityState === 'hidden') report(seconds.take());
    };
    const onPageHide = (): void => report(seconds.take());
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
      stop();
      alive = false;
      handle.current = null;
      apply.current = null;
      try {
        instance?.destroy();
      } catch {
        /* the iframe may already be gone */
      }
      mount.remove();
    };
    // one player for the sheet's whole visit
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <div ref={host} className="mf-src-yt" data-testid="mf-src-yt" />
      {failed ? (
        <p className="mf-src-fail" role="status">
          영상을 불러오지 못했습니다
        </p>
      ) : null}
    </>
  );
}
