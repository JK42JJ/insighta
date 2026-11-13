import { useEffect, useRef, useState } from 'react';

import { useWatchReporter } from '@/features/morning-feed/use-watch-reporter';

/*
 * The one YouTube IFrame player of the watch screen (수정 3). The swipe deck keeps its own
 * YouTubePlayer (sound carries over there); this one always starts a new video muted. It is created once and kept for the whole
 * visit: feed ↔ immersive playback and every card change reuse the same iframe (cueVideoById),
 * so the node is never rebuilt or moved (design README "플레이어 위치 고정"). Nothing is drawn
 * over it (YouTube policy). Every new video starts muted (README §3: the next card plays without
 * sound again, in both modes).
 *
 * Autoplay order (YouTube Required Minimum Functionality: no automatic playback before the
 * player is visible): a video is only CUED while the layer is hidden; the screen shows the layer
 * once the player reports it (onShown) and then sets `play`, which starts muted playback.
 */

interface YtPlayer {
  cueVideoById(videoId: string): void;
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
      videoId: string;
      width: string;
      height: string;
      playerVars: Record<string, string | number>;
      events: {
        onReady: (e: { target: YtPlayer }) => void;
        onError: () => void;
        onStateChange: (e: { data: number }) => void;
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
export const YT_PAUSED = 2;
export const YT_CUED = 5;
/** How often the sound state (the player's own control) and the time are read. */
export const PLAYER_POLL_MS = 250;
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

/** Lets the screen's buttons (outside the player) drive it. */
export interface PlayerController {
  /** Turns the sound on and plays (the mute button in its muted state). */
  soundOn: () => void;
  /** Turns the sound off only. */
  soundOff: () => void;
}

export interface PlayerTick {
  videoId: string;
  seconds: number;
  duration: number;
}

interface WatchPlayerProps {
  videoId: string;
  /** False while the card is leaving or no card is current: playback is paused. */
  active: boolean;
  /** The layer is visible: start (muted) playback of the cued video. */
  play: boolean;
  controller?: { current: PlayerController | null };
  /** The player shows the video (playing, paused or cued) — the thumbnail can give way. */
  onShown?: (videoId: string) => void;
  /** Every sound change, from the screen's button or the control inside the player. */
  onMuted?: (muted: boolean) => void;
  /** Playback position while the player has a video. */
  onTick?: (t: PlayerTick) => void;
  /** Called when playback cannot start. Nothing is ever drawn over the player. */
  onFailed?: (failed: boolean) => void;
}

export function WatchPlayer({
  videoId,
  active,
  play,
  controller,
  onShown,
  onMuted,
  onTick,
  onFailed,
}: WatchPlayerProps) {
  const cb = useRef({ onShown, onMuted, onTick, onFailed });
  cb.current = { onShown, onMuted, onTick, onFailed };
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<YtPlayer | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    cb.current.onFailed?.(failed);
  }, [failed]);

  const { reporter, positionRef } = useWatchReporter(videoId);
  const reporterRef = useRef(reporter);
  reporterRef.current = reporter;

  const ready = useRef(false);
  const playRef = useRef(play && active);
  playRef.current = play && active;
  const loaded = useRef(videoId);
  const first = useRef(videoId);
  const lastMuted = useRef(true);
  // set by cueVideoById: state events of the previous video are ignored until the new one is cued
  const pendingLoad = useRef(false);

  useEffect(() => {
    let alive = true;
    let poll: number | null = null;
    const mount = document.createElement('div');
    host.current?.appendChild(mount);
    const report = (p: YtPlayer): void => {
      const muted = p.isMuted();
      if (muted !== lastMuted.current) {
        lastMuted.current = muted;
        cb.current.onMuted?.(muted);
      }
    };
    loadYouTubeApi()
      .then((yt) => {
        if (!alive) return;
        player.current = new yt.Player(mount, {
          videoId: first.current,
          width: '100%',
          height: '100%',
          playerVars: {
            playsinline: 1,
            rel: 0,
            modestbranding: 1,
            controls: 1,
            mute: 1,
            autoplay: 0,
            origin: window.location.origin,
          },
          events: {
            onReady: (e) => {
              const p = e.target;
              ready.current = true;
              positionRef.current = () => p.getCurrentTime();
              if (controller) {
                controller.current = {
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
                };
              }
              p.mute();
              lastMuted.current = true;
              // the card may have changed while the player was starting
              if (loaded.current !== first.current) {
                pendingLoad.current = true;
                p.cueVideoById(loaded.current);
              } else {
                cb.current.onShown?.(first.current);
                // the layer may already be visible (fallback timer): start now
                if (playRef.current) p.playVideo();
              }
              poll = window.setInterval(() => {
                try {
                  report(p);
                  const id = loaded.current;
                  cb.current.onTick?.({
                    videoId: id,
                    seconds: p.getCurrentTime(),
                    duration: p.getDuration(),
                  });
                } catch {
                  /* player gone */
                }
              }, PLAYER_POLL_MS);
            },
            onError: () => alive && setFailed(true),
            onStateChange: (e) => {
              if (!alive) return;
              reporterRef.current.onState(e.data);
              if (e.data === YT_CUED) pendingLoad.current = false;
              if (pendingLoad.current) return;
              if (e.data === YT_PLAYING || e.data === YT_PAUSED || e.data === YT_CUED) {
                cb.current.onShown?.(loaded.current);
              }
              if (e.data === YT_CUED && playRef.current) player.current?.playVideo();
            },
          },
        });
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
      ready.current = false;
      if (controller) controller.current = null;
      if (poll != null) window.clearInterval(poll);
      try {
        player.current?.destroy();
      } catch {
        /* the iframe may already be gone */
      }
      player.current = null;
      mount.remove();
    };
  }, []);

  useEffect(() => {
    setFailed(false);
    if (videoId === loaded.current) return;
    loaded.current = videoId;
    const p = player.current;
    if (!ready.current || !p) return; // onReady loads it
    try {
      // README §3: the next card starts without sound, in the feed and in immersive playback
      p.mute();
      pendingLoad.current = true;
      p.cueVideoById(videoId);
      if (!lastMuted.current) {
        lastMuted.current = true;
        cb.current.onMuted?.(true);
      }
    } catch {
      setFailed(true);
    }
  }, [videoId]);

  useEffect(() => {
    try {
      if (!active) player.current?.pauseVideo();
      else if (play && ready.current) player.current?.playVideo();
    } catch {
      /* not ready yet */
    }
  }, [active, play, videoId]);

  return <div ref={host} className="mf-w3-yt" />;
}
