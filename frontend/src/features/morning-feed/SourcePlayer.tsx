import { useEffect, useRef, useState } from 'react';

import { PlayRanges, type PlayRange } from '@/features/morning-feed/play-range';
import { PlaySeconds } from '@/features/morning-feed/play-seconds';
import { useWatchReporter, YT_STATE_PLAYING } from '@/features/morning-feed/use-watch-reporter';
import { loadYouTubeApi, type YtPlayer } from '@/features/morning-feed/youtube-iframe-api';

/*
 * The source sheet's one YouTube player: the same iframe for every source tapped in this article,
 * also after the sheet was put away (order 2026-11-25 B5-2). Another video is loaded into it, the
 * same video only moves to the source's second, and the sheet's small form pauses it. It starts
 * with sound. When the browser refuses that (iPhone), the video is left cued, so YouTube's own
 * play button shows; it is never started muted instead. Nothing is drawn over it. While a video is
 * being put into it the player is not shown (the thumbnail under it is), and it only starts once
 * it is shown again: the black frame of a loading player is not seen (design 2026-11-25).
 */

export interface SourceTarget {
  videoId: string;
  t: number;
  /** Changes with every tap on a source (the same source tapped again plays from its second). */
  key: number;
  /** The sentence it was opened from (what a played part is recorded with). */
  sid?: string;
}

export interface SourcePlayerHandle {
  /** Pauses (the sheet gets small or goes away) and reports what was played so far. */
  pause: () => void;
  /** Where the shown video is; null = it has not played yet. */
  position: () => number | null;
}

interface Props {
  target: SourceTarget;
  /** The player is in view: only then a video is started (YouTube: more than half is visible). */
  live: boolean;
  handle: { current: SourcePlayerHandle | null };
  /** Whole seconds a video played (after it was switched, closed, or the page was hidden). */
  onWatched: (videoId: string, seconds: number) => void;
  /** A part of a video that was played without a jump. */
  onRange?: (r: PlayRange, sid: string | undefined) => void;
}

/** YT.PlayerState.CUED */
const YT_STATE_CUED = 5;
/** The player is shown after this long also when it never said it was ready with the video. */
const SHOW_LATEST_MS = 1500;
/** How often the position is read for the played parts. */
const RANGE_SAMPLE_MS = 500;

export function SourcePlayer({ target, live, handle, onWatched, onRange }: Props): JSX.Element {
  const host = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  /** The player has the wanted video: it is drawn over the thumbnail. */
  const [shown, setShown] = useState(false);
  /** A failed load is tried again with the next tap. */
  const [attempt, setAttempt] = useState(0);
  const want = useRef(target);
  const liveRef = useRef(live);
  const sync = useRef<(() => void) | null>(null);
  const watched = useRef(onWatched);
  watched.current = onWatched;
  const ranged = useRef(onRange);
  ranged.current = onRange;
  const { reporter, positionRef } = useWatchReporter(target.videoId);

  useEffect(() => {
    want.current = target;
    liveRef.current = live;
    if (failed && live) {
      setFailed(false);
      setAttempt((n) => n + 1);
      return;
    }
    sync.current?.();
    // a new tap is a new key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.key, live]);

  useEffect(() => {
    let alive = true;
    let instance: YtPlayer | null = null;
    /** The target the player was given last. */
    let loaded: SourceTarget | null = null;
    let played = false;
    let blocked = false;
    let ready = false;
    /** The shown video was started, and was not paused by us since. */
    let started = false;
    /** A video was cued and is not in the player yet. */
    let coming = false;
    let latest: number | null = null;
    const seconds = new PlaySeconds();
    const ranges = new PlayRanges((r) => ranged.current?.(r, loaded?.sid));
    let playing = false;
    const sample = (): void => {
      if (!instance || !loaded) return;
      try {
        ranges.sample(loaded.videoId, instance.getCurrentTime(), playing, Date.now());
      } catch {
        /* not ready or already gone */
      }
    };
    const sampler = window.setInterval(() => playing && sample(), RANGE_SAMPLE_MS);
    const report = (n: number): void => {
      if (loaded && n > 0) watched.current(loaded.videoId, n);
    };
    const mount = document.createElement('div');
    host.current?.appendChild(mount);

    /** The cued video is in the player: it is shown, then played. */
    const arrived = (): void => {
      if (latest !== null) window.clearTimeout(latest);
      latest = null;
      if (!coming || !alive) return;
      coming = false;
      setShown(true);
      if (started && !blocked && liveRef.current) instance?.playVideo();
    };
    const put = (p: YtPlayer, at: { videoId: string; startSeconds: number }): void => {
      coming = true;
      played = false;
      playing = false;
      setShown(false);
      p.cueVideoById(at);
      if (latest !== null) window.clearTimeout(latest);
      latest = window.setTimeout(arrived, SHOW_LATEST_MS);
    };
    /** Plays what is wanted, as soon as the player is ready and in view. */
    const go = (): void => {
      const p = instance;
      if (!p || !ready || !loaded || !liveRef.current) return;
      const t = want.current;
      if (loaded.key === t.key) {
        // back from the small form: on from where it was paused
        if (!started) {
          started = true;
          if (!coming) p.playVideo();
        }
        return;
      }
      const same = loaded.videoId === t.videoId;
      const at = { videoId: t.videoId, startSeconds: Math.max(0, t.t) };
      ranges.end();
      report(same ? seconds.take() : seconds.end());
      loaded = t;
      started = true;
      // blocked: refused once and not played since, it would be refused again (the play button shows)
      if (!same || blocked || coming) {
        put(p, at);
      } else {
        p.seekTo(at.startSeconds, true);
        p.playVideo();
      }
    };
    sync.current = go;

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
              if (!alive) return;
              const p = e.target;
              instance = p;
              ready = true;
              positionRef.current = () => p.getCurrentTime();
              // YouTube remembers the muted state of the video screen's player
              p.unMute();
              if (want.current.videoId === first.videoId) setShown(true);
              go();
            },
            onError: () => {
              // YouTube says so in the player itself
              if (!alive) return;
              coming = false;
              setShown(true);
            },
            onStateChange: (e) => {
              if (!alive) return;
              if (e.data === YT_STATE_CUED) arrived();
              if (e.data === YT_STATE_PLAYING) {
                // a start that was on its way while the sheet got small or left
                if (!liveRef.current) {
                  instance?.pauseVideo();
                  return;
                }
                played = true;
                blocked = false;
              }
              playing = e.data === YT_STATE_PLAYING;
              sample();
              seconds.onState(e.data);
              reporter.onState(e.data);
            },
            onAutoplayBlocked: () => {
              if (!alive || !instance || !loaded) return;
              blocked = true;
              // on from where it was, when it had played before
              const from = played ? instance.getCurrentTime() : loaded.t;
              instance.cueVideoById({ videoId: loaded.videoId, startSeconds: Math.max(0, from) });
            },
          },
        });
      })
      .catch(() => alive && setFailed(true));

    const pause = (): void => {
      started = false;
      report(seconds.end());
      if (playing) sample();
      ranges.end();
      playing = false;
      try {
        instance?.pauseVideo?.();
      } catch {
        /* not ready or already gone */
      }
    };
    handle.current = {
      pause,
      position: () => {
        // another video was asked for and not given to the player yet
        if (!played || loaded?.videoId !== want.current.videoId) return null;
        try {
          return instance?.getCurrentTime() ?? null;
        } catch {
          return null;
        }
      },
    };
    const onHide = (): void => {
      if (document.visibilityState !== 'hidden') return;
      report(seconds.take());
      ranges.end();
    };
    const onPageHide = (): void => {
      report(seconds.take());
      ranges.end();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
      pause();
      window.clearInterval(sampler);
      if (latest !== null) window.clearTimeout(latest);
      alive = false;
      setShown(false);
      handle.current = null;
      sync.current = null;
      try {
        instance?.destroy();
      } catch {
        /* the iframe may already be gone */
      }
      mount.remove();
    };
    // one player for the article's whole visit
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  return (
    <>
      <div
        ref={host}
        className="mf-src-yt"
        data-testid="mf-src-yt"
        data-shown={shown ? '' : undefined}
      />
      {failed ? (
        <p className="mf-src-fail" role="status">
          영상을 불러오지 못했습니다
        </p>
      ) : null}
    </>
  );
}
