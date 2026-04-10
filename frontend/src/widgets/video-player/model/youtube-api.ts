// YouTube IFrame API types and loader

declare global {
  interface Window {
    YT: {
      Player: new (
        elementId: string,
        options: {
          events?: {
            onReady?: (event: { target: YTPlayer }) => void;
            onStateChange?: (event: { data: number }) => void;
          };
        }
      ) => YTPlayer;
      PlayerState: {
        PLAYING: number;
        PAUSED: number;
        ENDED: number;
        BUFFERING: number;
      };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

export interface YTPlayer {
  getCurrentTime: () => number;
  getPlayerState: () => number;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  loadVideoById: (videoId: string, startSeconds?: number) => void;
  pauseVideo: () => void;
  playVideo: () => void;
  destroy: () => void;
}

let apiLoadPromise: Promise<void> | null = null;

export function loadYouTubeAPI(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve();

  if (apiLoadPromise) return apiLoadPromise;

  apiLoadPromise = new Promise((resolve) => {
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    const firstScriptTag = document.getElementsByTagName('script')[0];
    firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag);

    window.onYouTubeIframeAPIReady = () => {
      resolve();
    };
  });

  return apiLoadPromise;
}

export function getYouTubeVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\s?]+)/,
    /youtube\.com\/watch\?.*v=([^&\s]+)/,
    /youtube\.com\/shorts\/([^&\s?]+)/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

export function getTimestamp(url: string): number {
  const match = url.match(/[?&]t=(\d+)s?/);
  return match ? parseInt(match[1], 10) : 0;
}

export function formatTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
