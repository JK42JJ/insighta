import { useEffect, useRef, useState } from 'react';

/*
 * The video area of a live card: one YouTube IFrame player (16:9), muted autoplay once the card
 * is on screen, one player at a time (it is rebuilt per card and destroyed on the way out).
 * Nothing is drawn over the player (YouTube policy).
 */

interface YtPlayer {
  loadVideoById(videoId: string): void;
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

  const ready = useRef(false);
  const loaded = useRef(videoId);
  const wantSound = useRef(soundPreferred());
  const first = useRef(videoId);

  // One player for the whole screen. A new card calls loadVideoById on it instead of building a
  // new iframe: the sound the person turned on belongs to this player, so it carries over (a
  // fresh iframe per card starts muted again and the browser will not unmute it without a tap).
  useEffect(() => {
    let alive = true;
    let watcher: number | null = null;
    const mount = document.createElement('div');
    host.current?.appendChild(mount);
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
            autoplay: 1,
            origin: window.location.origin,
          },
          events: {
            onReady: (e) => {
              const p = e.target;
              ready.current = true;
              if (wantSound.current) {
                // a returning visitor who chose sound: try it, fall back to muted if the browser refuses
                p.unMute();
                p.playVideo();
                window.setTimeout(() => {
                  if (!alive) return;
                  try {
                    if (p.getPlayerState() !== PLAYING) {
                      p.mute();
                      p.playVideo();
                    }
                  } catch {
                    /* player gone */
                  }
                }, SOUND_START_GRACE_MS);
              } else {
                p.mute();
                p.playVideo();
              }
              // the sound button inside the player is the only control: watch it and remember the choice
              watcher = window.setInterval(() => {
                try {
                  if (p.getPlayerState() !== PLAYING) return;
                  const on = !p.isMuted();
                  if (on !== wantSound.current) {
                    wantSound.current = on;
                    rememberSound(on);
                  }
                } catch {
                  /* player gone */
                }
              }, WATCH_MS);
              // the card may have changed while the player was starting
              if (loaded.current !== first.current) {
                p.loadVideoById(loaded.current);
                if (wantSound.current) p.unMute();
              }
            },
            onError: () => alive && setFailed(true),
          },
        });
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
      ready.current = false;
      if (watcher != null) window.clearInterval(watcher);
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
      p.loadVideoById(videoId);
      if (wantSound.current) p.unMute();
    } catch {
      setFailed(true);
    }
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
