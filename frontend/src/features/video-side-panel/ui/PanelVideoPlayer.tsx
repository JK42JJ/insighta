/**
 * YouTube IFrame API player for the side panel.
 *
 * Architecture:
 *   - Initial mount: iframe renders → onload event → YT.Player init (no setTimeout)
 *   - Video switch: loadVideoById() on existing player (no iframe remount)
 *   - Timestamp seek: seekTo() via playerRef
 *   - Panel close: component unmounts → player.destroy()
 */
import { useEffect, useRef, useCallback } from 'react';
import { getYouTubeVideoId, loadYouTubeAPI } from '@/widgets/video-player/model/youtube-api';
import type { YTPlayer } from '@/widgets/video-player/model/youtube-api';

export interface PanelVideoPlayerProps {
  videoUrl: string;
  startTime?: number;
  playerRef?: React.MutableRefObject<YTPlayer | null>;
  onReady?: () => void;
  /** Whether to auto-play on mount. False on persist-rehydrate (page refresh)
   *  to prevent unintended playback. Default: false (require explicit user action). */
  shouldAutoplay?: boolean;
}

export function PanelVideoPlayer({
  videoUrl,
  startTime,
  playerRef,
  onReady,
  shouldAutoplay = false,
}: PanelVideoPlayerProps) {
  const youtubeId = getYouTubeVideoId(videoUrl);
  const internalPlayerRef = useRef<YTPlayer | null>(null);
  const playerReadyRef = useRef(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const currentVideoIdRef = useRef<string | null>(null);
  const iframeIdRef = useRef(`panel-yt-${Date.now()}`);
  // Capture initial props at mount — embedSrc must NEVER change after mount,
  // otherwise iframe reloads and playback stops. Subsequent autoplay/startTime
  // changes are handled by player API (loadVideoById/seekTo), not iframe reload.
  const initialAutoplayRef = useRef(shouldAutoplay);
  const initialStartTimeRef = useRef(startTime);

  const setPlayer = useCallback(
    (p: YTPlayer | null) => {
      internalPlayerRef.current = p;
      if (playerRef) playerRef.current = p;
    },
    [playerRef]
  );

  // Load YouTube API script on mount
  useEffect(() => {
    loadYouTubeAPI();
  }, []);

  // iframe onload → initialize YT.Player (once only)
  const handleIframeLoad = useCallback(() => {
    if (!youtubeId || playerReadyRef.current) return;
    if (!window.YT?.Player) return;

    const player = new window.YT.Player(iframeIdRef.current, {
      events: {
        onReady: (event: { target: YTPlayer }) => {
          playerReadyRef.current = true;
          currentVideoIdRef.current = youtubeId;
          setPlayer(event.target);
          onReady?.();
        },
      },
    });

    // Don't call setPlayer here — wait for onReady only
    void player;
  }, [youtubeId, setPlayer, onReady]);

  // Video switch: use loadVideoById instead of iframe remount
  useEffect(() => {
    if (!youtubeId) return;
    if (!playerReadyRef.current || !internalPlayerRef.current) return;
    if (currentVideoIdRef.current === youtubeId) return;

    // Different video — switch without remount
    currentVideoIdRef.current = youtubeId;
    internalPlayerRef.current.loadVideoById(youtubeId, startTime ?? 0);
  }, [youtubeId, startTime]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (internalPlayerRef.current) {
        try {
          internalPlayerRef.current.destroy();
        } catch {
          // Ignore destroy errors
        }
        setPlayer(null);
        playerReadyRef.current = false;
        currentVideoIdRef.current = null;
      }
    };
  }, [setPlayer]);

  if (!youtubeId) {
    return (
      <div className="flex w-full items-center justify-center bg-black aspect-video shrink-0">
        <a
          href={videoUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="max-w-[80%] truncate text-xs text-[#4e4f5c] underline underline-offset-2 hover:text-[#9394a0]"
        >
          {videoUrl}
        </a>
      </div>
    );
  }

  // embedSrc uses INITIAL prop values (captured in refs) — never recomputed
  // from current props, to prevent iframe reload on re-renders.
  const initialStart = initialStartTimeRef.current;
  const embedSrc = `https://www.youtube.com/embed/${youtubeId}?autoplay=${initialAutoplayRef.current ? 1 : 0}&rel=0&modestbranding=1&enablejsapi=1${initialStart ? `&start=${Math.floor(initialStart)}` : ''}`;

  return (
    <div className="relative w-full shrink-0 bg-black" style={{ aspectRatio: '16/9' }}>
      <iframe
        ref={iframeRef}
        id={iframeIdRef.current}
        src={embedSrc}
        onLoad={handleIframeLoad}
        className="absolute inset-0 w-full h-full border-0"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
        title="Video player"
      />
    </div>
  );
}
