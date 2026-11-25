/*
 * The YouTube IFrame API, loaded once per page. It lives on window and is read through these
 * accessors instead of a global Window augmentation: widgets/video-player declares window.YT with
 * a different shape, and two global declarations of the same property must match (TS2687).
 */

export interface YtPlayer {
  loadVideoById(arg: { videoId: string; startSeconds?: number }): void;
  cueVideoById(arg: { videoId: string; startSeconds?: number }): void;
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

export interface YtApi {
  Player: new (
    el: HTMLElement,
    opts: {
      width: string;
      height: string;
      videoId?: string;
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
let apiPromise: Promise<YtApi> | null = null;

export function loadYouTubeApi(): Promise<YtApi> {
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
