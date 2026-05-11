import { useRef, useCallback, useState, useLayoutEffect, useEffect } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { VideoStrip } from './VideoStrip';
import { CenterPanel } from './CenterPanel';
import { RightPanel } from './RightPanel';
import { useLearningStore } from '@/pages/learning/model/useLearningStore';
import { cn } from '@/shared/lib/utils';
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

  const centerViewMode = useLearningStore((s) => s.centerViewMode);

  // CP438+1: ?t=N query param drives in-page seek. When the user clicks
  // an atom timestamp link in the sidebar/panel, the same-video case
  // doesn't unmount CenterPanel — useEffect on tParam fires seekTo on
  // the live player. The different-video case loads via startTime below.
  // CP446+ — 노트 모드에서는 playVideo + setIsPlaying skip (background
  // audio leak 방지). startTime 만 갱신해 영상 모드 복귀 시 그 위치 cue.
  useEffect(() => {
    if (targetSec === null || !Number.isFinite(targetSec)) return;
    if (!videoId) return;
    // Override resume position so reload-on-video-change also lands here.
    playbackMapRef.current.set(videoId, targetSec);
    const player = playerRef.current;
    if (!player) return;
    try {
      player.seekTo(targetSec, true);
      if (centerViewMode !== 'note') {
        player.playVideo?.();
        setIsPlaying(true);
      }
    } catch {
      // player not ready yet — startTime fallback handles it on mount
    }
  }, [tParam, targetSec, videoId, centerViewMode]);

  const handleUserPlayed = useCallback(() => {
    setIsPlaying(true);
  }, []);

  const handlePlayStateChange = useCallback((playing: boolean) => {
    setIsPlaying(playing);
  }, []);

  const startTime = playbackMapRef.current.get(videoId!) ?? 0;

  // CP446+ — note 모드에서 section click → navigate(?t=&vid=newvid) 시 PanelVideoPlayer
  // 의 videoId useEffect 가 shouldAutoplay 분기에 따라 loadVideoById (autoplay)
  // path 진입 → hidden 상태에서 background audio leak 가능. 노트 모드 진입/유지
  // (videoId 변경 포함) 시 강제 pause + isPlaying=false 로 cueVideoById path 보장.
  useEffect(() => {
    if (centerViewMode !== 'note') return;
    if (!videoId) return;
    try {
      playerRef.current?.pauseVideo();
    } catch {
      // player not ready
    }
    setIsPlaying(false);
  }, [centerViewMode, videoId]);

  return (
    <div className="flex h-full overflow-hidden">
      {/* 좌측 column = VideoStrip + CenterPanel (둘 다 px-10 → player 와
          좌우 polo align). RightPanel 은 별도 column. */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* CP445 (사용자 directive) — VideoStrip = player 폭 정렬. CenterPanel
            의 px-4 padding 과 동일 적용 (베젤 축소). 노트 모드 시 hidden. */}
        <div className={cn('shrink-0 pl-4 pr-3 pt-[5px]', centerViewMode === 'note' && 'hidden')}>
          <VideoStrip mandalaId={mandalaId!} currentVideoId={videoId!} />
        </div>
        <CenterPanel
          mandalaId={mandalaId!}
          videoId={videoId!}
          playerRef={playerRef}
          // CP446+ — 노트 모드 시 shouldAutoplay 강제 false. PanelVideoPlayer 의
          // videoId 변경 useEffect 가 cueVideoById (paused) path 로 진입 →
          // background audio leak 원천 차단 (race window 제거).
          shouldAutoplay={isPlaying && centerViewMode !== 'note'}
          onUserPlayed={handleUserPlayed}
          onPlayStateChange={handlePlayStateChange}
          startTime={startTime}
        />
      </div>
      <RightPanel mandalaId={mandalaId!} videoId={videoId!} playerRef={playerRef} />
    </div>
  );
}
