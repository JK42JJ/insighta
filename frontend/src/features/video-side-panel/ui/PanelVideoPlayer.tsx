/**
 * YouTube IFrame API player for the side panel.
 *
 * Architecture:
 *   - Initial mount: iframe renders → onload event → YT.Player init (no setTimeout)
 *   - Video switch: loadVideoById() on existing player (no iframe remount)
 *   - Timestamp seek: seekTo() via playerRef
 *   - Panel close: component unmounts → player.destroy()
 */
import { useEffect, useRef, useCallback, useState } from 'react';
import { getYouTubeVideoId, loadYouTubeAPI } from '@/widgets/video-player/model/youtube-api';
import type { YTPlayer } from '@/widgets/video-player/model/youtube-api';
import { handleThumbnailError, handleThumbnailLoad } from '@/shared/lib/image-utils';

export type PanelPlayerState = 'playing' | 'paused' | 'buffering' | 'ended' | 'unstarted' | 'cued';

export interface PanelVideoPlayerProps {
  videoUrl: string;
  startTime?: number;
  playerRef?: React.MutableRefObject<YTPlayer | null>;
  onReady?: () => void;
  /** Whether to auto-play on mount. False on persist-rehydrate (page refresh)
   *  to prevent unintended playback. Default: false (require explicit user action). */
  shouldAutoplay?: boolean;
  /** Called when the player transitions to PLAYING state for the first time
   *  (user clicked play in iframe). Used to enable subsequent autoplay. */
  onUserPlayed?: () => void;
  /** Called on every play/pause state change. True = playing, false = paused. */
  onPlayStateChange?: (isPlaying: boolean) => void;
  /** Called every ~1s with current player time/state/duration for chatbot context. */
  onTimeUpdate?: (time: number, state: PanelPlayerState, duration: number) => void;
}

const YT_STATE_MAP: Record<number, PanelPlayerState> = {
  [-1]: 'unstarted',
  0: 'ended',
  1: 'playing',
  2: 'paused',
  3: 'buffering',
  5: 'cued',
};

export function PanelVideoPlayer({
  videoUrl,
  startTime,
  playerRef,
  onReady,
  shouldAutoplay = false,
  onUserPlayed,
  onPlayStateChange,
  onTimeUpdate,
}: PanelVideoPlayerProps) {
  const youtubeId = getYouTubeVideoId(videoUrl);
  const internalPlayerRef = useRef<YTPlayer | null>(null);
  const playerReadyRef = useRef(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const currentVideoIdRef = useRef<string | null>(null);
  const iframeIdRef = useRef(`panel-yt-${Date.now()}`);
  // Capture initial props at mount — embedSrc must NEVER change after mount,
  // otherwise iframe reloads and playback stops. ALL embedSrc inputs must be
  // ref-cached: youtubeId, autoplay, startTime. Subsequent video switches use
  // player.loadVideoById() API; subsequent autoplay/startTime changes use refs.
  const initialAutoplayRef = useRef(shouldAutoplay);
  const initialStartTimeRef = useRef(startTime);
  const initialYoutubeIdRef = useRef(youtubeId);

  // Poster facade — the videoId whose sharp poster overlay is shown (null =
  // hidden). YouTube's NATIVE cued/paused iframe poster is low-res/blurry; we
  // cover it with a maxres <img> (deep fallback) until the video starts playing.
  // Initial: shown when the player opens cued (autoplay off); hidden if autoplay.
  const [posterVid, setPosterVid] = useState<string | null>(
    initialAutoplayRef.current ? null : (youtubeId ?? null)
  );

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

    const userPlayedFiredRef = { current: false };
    const player = new window.YT.Player(iframeIdRef.current, {
      events: {
        onReady: (event: { target: YTPlayer }) => {
          playerReadyRef.current = true;
          currentVideoIdRef.current = youtubeId;
          setPlayer(event.target);
          onReady?.();
        },
        onStateChange: (event: { data: number }) => {
          // YT.PlayerState.PLAYING = 1, PAUSED = 2
          if (event.data === 1) {
            setPosterVid(null); // playing → drop the poster facade (reveals iframe)
            if (!userPlayedFiredRef.current) {
              userPlayedFiredRef.current = true;
              onUserPlayed?.();
            }
            onPlayStateChange?.(true);
          } else if (event.data === 2) {
            onPlayStateChange?.(false);
          }

          if (onTimeUpdate && internalPlayerRef.current) {
            const p = internalPlayerRef.current;
            const mapped = YT_STATE_MAP[event.data] ?? 'unstarted';
            try {
              const t = p.getCurrentTime?.() ?? 0;
              const d = (p as unknown as { getDuration?: () => number }).getDuration?.() ?? 0;
              onTimeUpdate(t, mapped, d);
            } catch {
              // Player not ready
            }
          }
        },
      },
    });

    // Don't call setPlayer here — wait for onReady only
    void player;
  }, [youtubeId, setPlayer, onReady, onUserPlayed]);

  // Video switch: use loadVideoById (autoplay) or cueVideoById (paused)
  // depending on shouldAutoplay flag — keeps iframe stable across switches.
  useEffect(() => {
    if (!youtubeId) return;
    if (!playerReadyRef.current || !internalPlayerRef.current) return;
    if (currentVideoIdRef.current === youtubeId) return;

    currentVideoIdRef.current = youtubeId;
    // New video cued (paused → blurry native poster) → re-show our sharp poster;
    // autoplay → clear (it plays straight away, 'playing' would clear it anyway).
    setPosterVid(shouldAutoplay ? null : youtubeId);
    const player = internalPlayerRef.current;
    if (shouldAutoplay) {
      // loadVideoById per YT API spec: loads AND plays
      player.loadVideoById(youtubeId, startTime ?? 0);
    } else {
      // cueVideoById: loads but stays paused (poster shown)
      // Fall back to loadVideoById if cue not available
      const cueFn = (player as unknown as { cueVideoById?: (id: string, t?: number) => void })
        .cueVideoById;
      if (typeof cueFn === 'function') {
        cueFn.call(player, youtubeId, startTime ?? 0);
      } else {
        player.loadVideoById(youtubeId, startTime ?? 0);
        // Pause immediately if cue is unavailable
        try {
          (player as unknown as { pauseVideo?: () => void }).pauseVideo?.();
        } catch {
          // ignore
        }
      }
    }
  }, [youtubeId, startTime, shouldAutoplay]);

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

  // Poll player time/state every 1s when playing — feeds chatbot region readable.
  useEffect(() => {
    if (!onTimeUpdate) return;
    const id = window.setInterval(() => {
      const p = internalPlayerRef.current;
      if (!p || !playerReadyRef.current) return;
      try {
        const stateNum = (p as unknown as { getPlayerState?: () => number }).getPlayerState?.();
        const mapped = stateNum != null ? (YT_STATE_MAP[stateNum] ?? 'unstarted') : 'unstarted';
        // Only emit while playing — avoid noisy paused-state updates.
        if (mapped !== 'playing') return;
        const t = p.getCurrentTime?.() ?? 0;
        const d = (p as unknown as { getDuration?: () => number }).getDuration?.() ?? 0;
        onTimeUpdate(t, mapped, d);
      } catch {
        // Player transient state — ignore.
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [onTimeUpdate]);

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
  // CRITICAL: youtubeId must also be ref-cached. If embedSrc changes (different
  // videoId in URL), browser reloads iframe. Subsequent loadVideoById calls
  // can't reach the new iframe → second-card "stays paused" bug.
  const initialStart = initialStartTimeRef.current;
  const initialYoutubeId = initialYoutubeIdRef.current;
  const embedSrc = initialYoutubeId
    ? `https://www.youtube.com/embed/${initialYoutubeId}?autoplay=${initialAutoplayRef.current ? 1 : 0}&rel=0&modestbranding=1&enablejsapi=1${initialStart ? `&start=${Math.floor(initialStart)}` : ''}`
    : '';

  return (
    <div
      className="relative mx-auto w-full shrink-0 overflow-hidden rounded-lg bg-black"
      // CP445.x — max-height 49.5vh (55vh 에서 10% 축소, 사용자 spec). 하단
      // 탭 콘텐츠 영역 추가 확보. aspect-ratio 16:9 유지 + max-width 도 비례
      // cap (16/9 보존 + 가운데).
      style={{
        aspectRatio: '16/9',
        maxHeight: '49.5vh',
        maxWidth: 'calc(49.5vh * 16 / 9)',
      }}
    >
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
      {/* Poster facade — covers YouTube's blurry native cued/paused poster with a
          sharp maxres thumbnail (deep fallback via image-utils handlers) until the
          video plays. pointer-events-none → clicks pass THROUGH to the iframe's
          native play; 'playing' (onStateChange) clears posterVid → overlay unmounts.
          Decorative play glyph only. No player API call → zero state-machine risk. */}
      {posterVid && (
        <div className="pointer-events-none absolute inset-0 z-10">
          <img
            src={`https://img.youtube.com/vi/${posterVid}/maxresdefault.jpg`}
            onError={handleThumbnailError}
            onLoad={handleThumbnailLoad}
            alt=""
            className="h-full w-full object-cover"
          />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-black/60">
              <svg viewBox="0 0 24 24" className="h-7 w-7 translate-x-0.5 fill-white" aria-hidden="true">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
