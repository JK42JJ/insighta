import { useRef, useCallback, useState, useLayoutEffect, useEffect } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { VideoStrip } from './VideoStrip';
import { CenterPanel } from './CenterPanel';
import { RightPanel } from './RightPanel';
import type { YTPlayer } from '@/widgets/video-player/model/youtube-api';

export default function LearningPage() {
  const { mandalaId, videoId } = useParams<{ mandalaId: string; videoId: string }>();
  const [searchParams] = useSearchParams();
  const tParam = searchParams.get('t');
  const targetSec = tParam ? Math.max(0, Math.floor(Number(tParam))) : null;
  const playerRef = useRef<YTPlayer | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const playbackMapRef = useRef(new Map<string, number>());
  const prevVideoIdRef = useRef(videoId);

  useLayoutEffect(() => {
    const prev = prevVideoIdRef.current;
    if (prev && prev !== videoId && playerRef.current) {
      try {
        const time = playerRef.current.getCurrentTime();
        if (time > 0) playbackMapRef.current.set(prev, time);
      } catch {
        // player not ready
      }
    }
    prevVideoIdRef.current = videoId;
  }, [videoId]);

  // CP438+1: ?t=N query param drives in-page seek. When the user clicks
  // an atom timestamp link in the sidebar/panel, the same-video case
  // doesn't unmount CenterPanel — useEffect on tParam fires seekTo on
  // the live player. The different-video case loads via startTime below.
  useEffect(() => {
    if (targetSec === null || !Number.isFinite(targetSec)) return;
    if (!videoId) return;
    // Override resume position so reload-on-video-change also lands here.
    playbackMapRef.current.set(videoId, targetSec);
    const player = playerRef.current;
    if (!player) return;
    try {
      player.seekTo(targetSec, true);
      player.playVideo?.();
      setIsPlaying(true);
    } catch {
      // player not ready yet — startTime fallback handles it on mount
    }
  }, [tParam, targetSec, videoId]);

  const handleUserPlayed = useCallback(() => {
    setIsPlaying(true);
  }, []);

  const handlePlayStateChange = useCallback((playing: boolean) => {
    setIsPlaying(playing);
  }, []);

  const startTime = playbackMapRef.current.get(videoId!) ?? 0;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <VideoStrip mandalaId={mandalaId!} currentVideoId={videoId!} />
      <div className="flex flex-1 overflow-hidden">
        <CenterPanel
          mandalaId={mandalaId!}
          videoId={videoId!}
          playerRef={playerRef}
          shouldAutoplay={isPlaying}
          onUserPlayed={handleUserPlayed}
          onPlayStateChange={handlePlayStateChange}
          startTime={startTime}
        />
        <RightPanel mandalaId={mandalaId!} videoId={videoId!} playerRef={playerRef} />
      </div>
    </div>
  );
}
