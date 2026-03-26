import { useEffect, useRef, useCallback, useReducer } from 'react';
import { cn } from '@/shared/lib/utils';
import type { YTPlayer } from '../model/youtube-api';
import { loadYouTubeAPI } from '../model/youtube-api';
import { SeekIndicator } from './SeekIndicator';

const WATCH_POSITION_INTERVAL_MS = 30_000;
const WATCH_POSITION_MIN_DELTA = 1;
const SEEK_SECONDS = 5;
const SEEK_DEBOUNCE_MS = 300;

interface YouTubePlayerProps {
  videoId: string;
  startTime: number;
  onPlayerReady: () => void;
  onSaveWatchPosition?: (positionSeconds: number) => void;
  playerRef: React.MutableRefObject<YTPlayer | null>;
  className?: string;
}

export function YouTubePlayer({
  videoId,
  startTime,
  onPlayerReady,
  onSaveWatchPosition,
  playerRef,
  className,
}: YouTubePlayerProps) {
  const iframeIdRef = useRef(`yt-player-${videoId}-${Date.now()}`);
  const iframeId = iframeIdRef.current;
  const playerReadyRef = useRef(false);
  const watchIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastSavedPosRef = useRef(startTime);
  const seekTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSeekRef = useRef<{
    direction: 'forward' | 'backward';
    seconds: number;
    baseTime: number;
  } | null>(null);
  const seekIndicatorRef = useRef<{
    direction: 'forward' | 'backward';
    seconds: number;
  } | null>(null);
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);

  // Capture initial startTime so embedUrl never changes on re-renders (prevents iframe reload/flicker)
  const initialStartTimeRef = useRef(startTime);
  const embedUrl = `https://www.youtube.com/embed/${videoId}?start=${Math.floor(initialStartTimeRef.current)}&autoplay=1&rel=0&modestbranding=1&enablejsapi=1`;

  // Initialize YT Player
  useEffect(() => {
    let cancelled = false;

    const initPlayer = async () => {
      await loadYouTubeAPI();
      if (cancelled) return;

      setTimeout(() => {
        if (cancelled || !document.getElementById(iframeId)) return;
        playerRef.current = new window.YT.Player(iframeId, {
          events: {
            onReady: (event: { target: YTPlayer }) => {
              playerReadyRef.current = true;
              if (startTime > 0) {
                event.target.seekTo(startTime, true);
              }
              onPlayerReady();
            },
          },
        });
      }, 500);
    };

    initPlayer();

    return () => {
      cancelled = true;
      if (playerRef.current) {
        try {
          playerRef.current.destroy();
        } catch {
          // Ignore destroy errors
        }
        playerRef.current = null;
      }
      playerReadyRef.current = false;
    };
  }, [videoId, iframeId]);

  // Save watch position periodically
  const saveCurrentPosition = useCallback(() => {
    if (!playerRef.current || !playerReadyRef.current || !onSaveWatchPosition) return;
    try {
      const currentTime = Math.floor(playerRef.current.getCurrentTime());
      if (Math.abs(currentTime - lastSavedPosRef.current) >= WATCH_POSITION_MIN_DELTA) {
        lastSavedPosRef.current = currentTime;
        onSaveWatchPosition(currentTime);
      }
    } catch {
      // Player might not be ready
    }
  }, [onSaveWatchPosition]);

  useEffect(() => {
    if (!onSaveWatchPosition) return;
    lastSavedPosRef.current = startTime;
    watchIntervalRef.current = setInterval(saveCurrentPosition, WATCH_POSITION_INTERVAL_MS);

    return () => {
      if (watchIntervalRef.current) {
        clearInterval(watchIntervalRef.current);
        watchIntervalRef.current = null;
      }
      saveCurrentPosition();
    };
  }, [onSaveWatchPosition, saveCurrentPosition]);

  // Fullscreen fix
  useEffect(() => {
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement) {
        requestAnimationFrame(() => {
          document.body.style.display = 'none';
          void document.body.offsetHeight; // Force reflow
          document.body.style.display = '';
        });
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
    };
  }, []);

  // Keyboard controls
  useEffect(() => {
    const executeSeek = () => {
      if (!pendingSeekRef.current || !playerRef.current) return;
      const { direction, seconds, baseTime } = pendingSeekRef.current;
      const targetTime =
        direction === 'forward' ? baseTime + seconds : Math.max(0, baseTime - seconds);
      playerRef.current.seekTo(targetTime, true);
      pendingSeekRef.current = null;
      setTimeout(() => {
        seekIndicatorRef.current = null;
        forceUpdate();
      }, 300);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;
      if (!playerRef.current || !playerReadyRef.current) return;

      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const direction = e.key === 'ArrowLeft' ? 'backward' : 'forward';

        if (!pendingSeekRef.current || pendingSeekRef.current.direction !== direction) {
          const currentTime = playerRef.current.getCurrentTime();
          pendingSeekRef.current = { direction, seconds: SEEK_SECONDS, baseTime: currentTime };
        } else {
          pendingSeekRef.current.seconds += SEEK_SECONDS;
        }

        seekIndicatorRef.current = {
          direction,
          seconds: pendingSeekRef.current.seconds,
        };
        forceUpdate();

        if (seekTimeoutRef.current) clearTimeout(seekTimeoutRef.current);
        seekTimeoutRef.current = setTimeout(executeSeek, SEEK_DEBOUNCE_MS);
      } else if (e.key === ' ') {
        e.preventDefault();
        const state = playerRef.current.getPlayerState();
        if (state === 1) {
          playerRef.current.pauseVideo();
        } else {
          playerRef.current.playVideo();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (seekTimeoutRef.current) clearTimeout(seekTimeoutRef.current);
    };
  }, []);

  return (
    <div className={cn("relative w-full", className ?? "aspect-video")} style={{ background: 'hsl(var(--bg-base))' }}>
      <iframe
        id={iframeId}
        src={embedUrl}
        title="YouTube video player"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
        className="absolute inset-0 w-full h-full border-0"
      />
      {seekIndicatorRef.current && (
        <SeekIndicator
          direction={seekIndicatorRef.current.direction}
          seconds={seekIndicatorRef.current.seconds}
        />
      )}
    </div>
  );
}
