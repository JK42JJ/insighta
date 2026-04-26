import { useRef, useCallback, useState, useLayoutEffect } from 'react';
import { useParams } from 'react-router-dom';
import { VideoStrip } from './VideoStrip';
import { CenterPanel } from './CenterPanel';
import { RightPanel } from './RightPanel';
import type { YTPlayer } from '@/widgets/video-player/model/youtube-api';

export default function LearningPage() {
  const { mandalaId, videoId } = useParams<{ mandalaId: string; videoId: string }>();
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
