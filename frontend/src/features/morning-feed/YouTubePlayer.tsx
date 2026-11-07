import { useEffect, useRef, useState } from 'react';

/*
 * The video area of a live card: one YouTube IFrame player (16:9), muted autoplay once the card
 * is on screen, one player at a time (it is rebuilt per card and destroyed on the way out).
 * Nothing is drawn over the player (YouTube policy).
 */

interface YtPlayer {
  mute(): void;
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
              e.target.mute();
              e.target.playVideo();
            },
            onError: () => alive && setFailed(true),
          },
        });
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
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
