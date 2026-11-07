import { useEffect, useRef, useState } from 'react';

/*
 * The video area of a live card: one YouTube IFrame player (16:9), muted autoplay once the card
 * is on screen, one player at a time (it is rebuilt per card and destroyed on the way out).
 * Nothing is drawn over the player (YouTube policy).
 */

interface YtPlayer {
  mute(): void;
  unMute(): void;
  isMuted(): boolean;
  getPlayerState(): number;
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
      events: { onReady: (e: { target: YtPlayer }) => void; onError: () => void };
    }
  ) => YtPlayer;
}
declare global {
  interface Window {
    YT?: YtApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const API_SRC = 'https://www.youtube.com/iframe_api';
const SOUND_KEY = 'mf_sound_on';
const PLAYING = 1;
const SOUND_START_GRACE_MS = 1500;
const WATCH_MS = 400;

/** Once the person turns the sound on, the next cards start with sound too. */
function soundPreferred(): boolean {
  try {
    return window.localStorage.getItem(SOUND_KEY) === '1';
  } catch {
    return false;
  }
}
function rememberSound(on: boolean): void {
  try {
    window.localStorage.setItem(SOUND_KEY, on ? '1' : '0');
  } catch {
    /* private mode */
  }
}
let apiPromise: Promise<YtApi> | null = null;

function loadYouTubeApi(): Promise<YtApi> {
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise<YtApi>((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      if (window.YT) resolve(window.YT);
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

interface YouTubePlayerProps {
  videoId: string;
  /** False while the card is leaving or a sheet covers it: playback is paused. */
  active: boolean;
}

export function YouTubePlayer({ videoId, active }: YouTubePlayerProps) {
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<YtPlayer | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    let watcher: number | null = null;
    setFailed(false);
    const mount = document.createElement('div');
    host.current?.appendChild(mount);
    loadYouTubeApi()
      .then((yt) => {
        if (!alive) return;
        player.current = new yt.Player(mount, {
          videoId,
          width: '100%',
          height: '100%',
          playerVars: {
            playsinline: 1,
            rel: 0,
            modestbranding: 1,
            controls: 1,
            mute: 1,
            autoplay: 1,
            origin: window.location.origin,
          },
          events: {
            onReady: (e) => {
              const p = e.target;
              let autoMuted = false;
              if (soundPreferred()) {
                // try with sound first; a browser that refuses gets the muted fallback
                p.unMute();
                p.playVideo();
                window.setTimeout(() => {
                  if (!alive) return;
                  try {
                    if (p.getPlayerState() !== PLAYING) {
                      autoMuted = true;
                      p.mute();
                      p.playVideo();
                    }
                  } catch {
                    /* player gone */
                  }
                }, SOUND_START_GRACE_MS);
              } else {
                autoMuted = true;
                p.mute();
                p.playVideo();
              }
              // the sound button inside the player is the only control: watch it and remember the choice
              watcher = window.setInterval(() => {
                try {
                  if (p.getPlayerState() !== PLAYING) return;
                  const muted = p.isMuted();
                  if (autoMuted && !muted) {
                    autoMuted = false;
                    rememberSound(true);
                  } else if (!autoMuted && muted) {
                    autoMuted = true;
                    rememberSound(false);
                  }
                } catch {
                  /* player gone */
                }
              }, WATCH_MS);
            },
            onError: () => alive && setFailed(true),
          },
        });
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
      if (watcher != null) window.clearInterval(watcher);
      try {
        player.current?.destroy();
      } catch {
        /* the iframe may already be gone */
      }
      player.current = null;
      mount.remove();
    };
  }, [videoId]);

  useEffect(() => {
    try {
      if (!active) player.current?.pauseVideo();
    } catch {
      /* not ready yet */
    }
  }, [active]);

  return (
    <div ref={host} style={{ position: 'absolute', inset: 0, background: 'var(--mf-page)' }}>
      {failed ? (
        <a
          href={'https://www.youtube.com/watch?v=' + videoId}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            color: 'var(--mf-white)',
            font: '700 14px sans-serif',
          }}
        >
          YouTube에서 열기
        </a>
      ) : null}
    </div>
  );
}
