import { useEffect, useRef, useState } from 'react';

import { useWatchReporter } from '@/features/morning-feed/use-watch-reporter';

/*
 * The one YouTube IFrame player of the watch screen (design 수정 4). It is created once and kept
 * for the whole visit: feed ↔ immersive playback and every card change reuse the same iframe, so
 * the node is never rebuilt or moved. Nothing is drawn over it (YouTube policy).
 *
 * The screen drives it with one command, `load(videoId, startSeconds, withSound)`, and calls it
 * only once the player layer is more than half visible (YouTube Required Minimum Functionality:
 * "an API Client must not initiate an automatic playback until the player is visible").
 *
 * Sound (README "음소거 단추 — 소리 상태 유지"): the screen asks for sound when the session's
 * setting is on. When the browser refuses playback with sound (onAutoplayBlocked, or no PLAYING
 * with sound within SOUND_CHECK_MS), the player goes back to muted playback and reports the
 * muted state — the button then shows it, nothing else (James 2026-11-13).
 */

interface YtPlayer {
  loadVideoById(arg: { videoId: string; startSeconds?: number }): void;
  mute(): void;
  unMute(): void;
  isMuted(): boolean;
  getPlayerState(): number;
  getCurrentTime(): number;
  getDuration(): number;
  playVideo(): void;
  pauseVideo(): void;
  destroy(): void;
}
interface YtApi {
  Player: new (
    el: HTMLElement,
    opts: {
      width: string;
      height: string;
      playerVars: Record<string, string | number>;
      events: {
        onReady: (e: { target: YtPlayer }) => void;
        onError: () => void;
        onStateChange: (e: { data: number }) => void;
        onAutoplayBlocked: () => void;
      };
    }
  ) => YtPlayer;
}
/*
 * The IFrame API lives on window. It is read through these accessors instead of a global Window
 * augmentation: widgets/video-player declares window.YT with a different shape, and two global
 * declarations of the same property must match (TS2687).
 */
interface YtWindow {
  YT?: YtApi;
  onYouTubeIframeAPIReady?: () => void;
}
function ytWindow(): YtWindow {
  return window as unknown as YtWindow;
}
function ytApi(): YtApi | undefined {
  return ytWindow().YT;
}

const API_SRC = 'https://www.youtube.com/iframe_api';
/** YT.PlayerState */
export const YT_PLAYING = 1;
/** How often the sound state (the player's own control) and the time are read. */
export const PLAYER_POLL_MS = 250;
/** No PLAYING with sound by then = the browser refused sound (same grace as the deck player). */
export const SOUND_CHECK_MS = 1500;
let apiPromise: Promise<YtApi> | null = null;

function loadYouTubeApi(): Promise<YtApi> {
  const ready = ytApi();
  if (ready && ready.Player) return Promise.resolve(ready);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise<YtApi>((resolve, reject) => {
    const w = ytWindow();
    const prev = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => {
      prev?.();
      const yt = ytApi();
      if (yt) resolve(yt);
    };
    const s = document.createElement('script');
    s.src = API_SRC;
    s.async = true;
    s.onerror = () => {
      apiPromise = null;
      reject(new Error('youtube api failed to load'));
    };
    document.head.appendChild(s);
  });
  return apiPromise;
}

/** Lets the screen drive the player. Every call is a no-op until the player is ready. */
export interface PlayerController {
  /** Starts the video (muted or with sound). Call only when the layer is more than half visible. */
  load: (videoId: string, startSeconds: number, withSound: boolean) => void;
  /** Sound on and play (the mute button in its muted state — runs inside the tap). */
  soundOn: () => void;
  /** Sound off only. */
  soundOff: () => void;
  pause: () => void;
}

export interface PlayerTick {
  videoId: string;
  seconds: number;
  duration: number;
  playing: boolean;
}

interface WatchPlayerProps {
  controller: { current: PlayerController | null };
  /** The player can take commands (the first `load` may follow right away). */
  onReady?: () => void;
  /** The video given to `load` is playing (the thumbnail can give way, the line shows progress). */
  onPlaying?: (videoId: string) => void;
  /** Every sound change: the screen's button, YouTube's own control, or the blocked-sound fallback. */
  onMuted?: (muted: boolean) => void;
  /** Playback position of the loaded video. */
  onTick?: (t: PlayerTick) => void;
  /** Called when playback cannot start. Nothing is ever drawn over the player. */
  onFailed?: (failed: boolean) => void;
}

export function WatchPlayer({
  controller,
  onReady,
  onPlaying,
  onMuted,
  onTick,
  onFailed,
}: WatchPlayerProps) {
  const cb = useRef({ onReady, onPlaying, onMuted, onTick, onFailed });
  cb.current = { onReady, onPlaying, onMuted, onTick, onFailed };
  const host = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    cb.current.onFailed?.(failed);
  }, [failed]);

  const [currentId, setCurrentId] = useState('');
  const { reporter, positionRef } = useWatchReporter(currentId);
  const reporterRef = useRef(reporter);
  reporterRef.current = reporter;

  useEffect(() => {
    let alive = true;
    let poll: number | null = null;
    let soundCheck: number | null = null;
    let loaded = '';
    let lastMuted = true;
    const mount = document.createElement('div');
    host.current?.appendChild(mount);
    const report = (p: YtPlayer): void => {
      const muted = p.isMuted();
      if (muted !== lastMuted) {
        lastMuted = muted;
        cb.current.onMuted?.(muted);
      }
    };
    /** The browser refused playback with sound: muted playback, the button shows it. */
    const fallBackToMuted = (p: YtPlayer): void => {
      try {
        p.mute();
        p.playVideo();
        report(p);
      } catch {
        /* player gone */
      }
    };
    let instance: YtPlayer | null = null;
    loadYouTubeApi()
      .then((yt) => {
        if (!alive) return;
        instance = new yt.Player(mount, {
          width: '100%',
          height: '100%',
          playerVars: {
            playsinline: 1,
            rel: 0,
            controls: 1,
            autoplay: 0,
            origin: window.location.origin,
          },
          events: {
            onReady: (e) => {
              const p = e.target;
              positionRef.current = () => p.getCurrentTime();
              p.mute();
              controller.current = {
                load: (videoId, startSeconds, withSound) => {
                  try {
                    setFailed(false);
                    // report the previous video while the player is still on it (its position)
                    reporterRef.current.setVideo(videoId);
                    loaded = videoId;
                    setCurrentId(videoId);
                    if (soundCheck != null) window.clearTimeout(soundCheck);
                    if (withSound) p.unMute();
                    else p.mute();
                    p.loadVideoById({ videoId, startSeconds: Math.max(0, startSeconds) });
                    report(p);
                    if (!withSound) return;
                    soundCheck = window.setTimeout(() => {
                      soundCheck = null;
                      if (!alive || loaded !== videoId) return;
                      if (p.getPlayerState() !== YT_PLAYING || p.isMuted()) fallBackToMuted(p);
                    }, SOUND_CHECK_MS);
                  } catch {
                    setFailed(true);
                  }
                },
                soundOn: () => {
                  try {
                    p.unMute();
                    p.playVideo();
                    report(p);
                  } catch {
                    /* player gone */
                  }
                },
                soundOff: () => {
                  try {
                    p.mute();
                    report(p);
                  } catch {
                    /* player gone */
                  }
                },
                pause: () => {
                  try {
                    p.pauseVideo();
                  } catch {
                    /* player gone */
                  }
                },
              };
              poll = window.setInterval(() => {
                try {
                  report(p);
                  if (!loaded) return;
                  cb.current.onTick?.({
                    videoId: loaded,
                    seconds: p.getCurrentTime(),
                    duration: p.getDuration(),
                    playing: p.getPlayerState() === YT_PLAYING,
                  });
                } catch {
                  /* player gone */
                }
              }, PLAYER_POLL_MS);
              cb.current.onReady?.();
            },
            onError: () => alive && setFailed(true),
            onStateChange: (e) => {
              if (!alive) return;
              reporterRef.current.onState(e.data);
              if (e.data === YT_PLAYING && loaded) cb.current.onPlaying?.(loaded);
            },
            onAutoplayBlocked: () => {
              if (alive && instance) fallBackToMuted(instance);
            },
          },
        });
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
      controller.current = null;
      if (poll != null) window.clearInterval(poll);
      if (soundCheck != null) window.clearTimeout(soundCheck);
      try {
        instance?.destroy();
      } catch {
        /* the iframe may already be gone */
      }
      mount.remove();
    };
    // the player is built once for the whole visit
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={host} className="mf-w3-yt" />;
}
