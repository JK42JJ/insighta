import { useCallback, useEffect, useRef } from 'react';
import {
  useAllVideoStates,
  useUpdateVideoState,
} from '@/features/youtube-sync/model/useYouTubeSync';
import type { YTPlayer } from '@/widgets/video-player/model/youtube-api';

/** Save cadence while playing (mirrors YouTubePlayer's WATCH_POSITION_INTERVAL_MS). */
const SAVE_INTERVAL_MS = 30_000;
/** Don't persist accidental brush-opens — require a few seconds of playback. */
const MIN_SAVE_SECONDS = 3;

/**
 * Persist the /learning player's watch position to `user_video_states` so the
 * dashboard grid can render a watched-progress bar and resume survives reload.
 *
 * Additive + minimal blast radius: it only READS the current player position via
 * the shared `playerRef` and WRITES through `useUpdateVideoState` — the exact
 * mutation the modal / DetailPanel already use, whose optimistic update targets
 * the same `allVideoStates` query the dashboard reads (so the bar updates live).
 * It touches no other component. No-op when the video is not a synced state row.
 *
 * Note (designed side effect): writing `watch_position_seconds > 0` activates the
 * dormant "don't re-recommend an already-watched video" exclusion in
 * auto-add-recommendations / v3 executor. That is the field's intended semantics.
 */
export function useSaveWatchPosition(
  videoId: string | undefined,
  playerRef: React.MutableRefObject<YTPlayer | null>,
  isPlaying: boolean
): void {
  const { data: videoStates } = useAllVideoStates();
  const updateVideoState = useUpdateVideoState();

  // Resolve the YouTube id → the user_video_states row (id + stored position).
  const stateForVideo = videoStates?.find((s) => s.video?.youtube_video_id === videoId);
  const stateId = stateForVideo?.id;
  const storedPos = stateForVideo?.watch_position_seconds ?? 0;

  // Latest values in a ref so the interval/unmount closures stay stable (no
  // re-subscribe churn on every render) while still seeing fresh data.
  const dataRef = useRef({ stateId, storedPos, isPlaying });
  dataRef.current = { stateId, storedPos, isPlaying };
  // Highest position saved this session — enforces monotonic saves so scrubbing
  // backwards never shrinks the stored position (the bar/resume hold the max).
  const maxSavedRef = useRef(0);

  const saveNow = useCallback(() => {
    const { stateId: id, storedPos: stored } = dataRef.current;
    if (!id) return;
    const player = playerRef.current;
    if (!player) return;
    let t: number;
    try {
      t = Math.floor(player.getCurrentTime?.() ?? 0);
    } catch {
      return; // player transient state
    }
    if (!Number.isFinite(t) || t < MIN_SAVE_SECONDS) return;
    const floor = Math.max(stored, maxSavedRef.current);
    if (t <= floor) return; // monotonic guard
    maxSavedRef.current = t;
    updateVideoState.mutate(
      { videoStateId: id, updates: { watch_position_seconds: t } },
      {
        onError: () => {
          maxSavedRef.current = floor; // roll the guard back so a retry can save
        },
      }
    );
  }, [playerRef, updateVideoState]);

  // Reset the session max when the video changes.
  useEffect(() => {
    maxSavedRef.current = 0;
  }, [videoId]);

  // Periodic save while playing.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (dataRef.current.isPlaying) saveNow();
    }, SAVE_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [saveNow]);

  // Flush on tab hide / navigation-away, and on unmount (switching video/page).
  useEffect(() => {
    const onHide = () => saveNow();
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onHide);
      saveNow();
    };
  }, [saveNow]);
}
