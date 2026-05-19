/**
 * "핵심만 보기" — sequentially plays only the highly-relevant segments
 * (relevance_pct >= threshold) of the active video. User manual scrub
 * exits the mode so the user is never trapped.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { YTPlayer } from '@/widgets/video-player/model/youtube-api';
import type { VideoRichSummarySection } from '@/shared/lib/api-client';

export const HIGHLIGHT_RELEVANCE_THRESHOLD = 80;
const POLL_INTERVAL_MS = 500;
// Manual scrub tolerance — currentTime can drift up to ~1s from polling cadence;
// anything beyond this means the user moved the playhead.
const SCRUB_TOLERANCE_SEC = 2;

interface HighlightSection {
  from: number;
  to: number;
}

function pickHighlights(
  sections: VideoRichSummarySection[] | undefined,
  threshold = HIGHLIGHT_RELEVANCE_THRESHOLD
): HighlightSection[] {
  return (sections ?? [])
    .filter(
      (s) =>
        typeof s.relevance_pct === 'number' && s.relevance_pct >= threshold && s.to_sec > s.from_sec
    )
    .map((s) => ({ from: s.from_sec, to: s.to_sec }))
    .sort((a, b) => a.from - b.from);
}

export interface UseHighlightReelArgs {
  sections: VideoRichSummarySection[] | undefined;
  playerRef: React.MutableRefObject<YTPlayer | null>;
  threshold?: number;
}

export function useHighlightReel({ sections, playerRef, threshold }: UseHighlightReelArgs) {
  const highlights = pickHighlights(sections, threshold);
  const allHaveRelevance =
    (sections?.length ?? 0) > 0 &&
    (sections ?? []).every((s) => typeof s.relevance_pct === 'number');
  const enabled = allHaveRelevance && highlights.length > 0;

  const [active, setActive] = useState(false);
  const [currentIdx, setCurrentIdx] = useState(0);
  const expectedTimeRef = useRef<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = useCallback(() => {
    setActive(false);
    setCurrentIdx(0);
    expectedTimeRef.current = null;
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    try {
      playerRef.current?.pauseVideo();
    } catch {
      /* swallow */
    }
  }, [playerRef]);

  const start = useCallback(() => {
    if (!enabled || !playerRef.current) return;
    const first = highlights[0]!;
    try {
      playerRef.current.seekTo(first.from, true);
      playerRef.current.playVideo();
    } catch {
      return;
    }
    expectedTimeRef.current = first.from;
    setCurrentIdx(0);
    setActive(true);
  }, [enabled, highlights, playerRef]);

  useEffect(() => {
    if (!active) return;
    intervalRef.current = setInterval(() => {
      const player = playerRef.current;
      if (!player) return;
      let now: number;
      try {
        now = player.getCurrentTime();
      } catch {
        return;
      }
      const expected = expectedTimeRef.current ?? now;
      // Manual scrub guard — user moved the playhead, exit mode.
      if (Math.abs(now - expected) > SCRUB_TOLERANCE_SEC && currentIdx > 0) {
        stop();
        return;
      }
      expectedTimeRef.current = now;
      const cur = highlights[currentIdx];
      if (!cur) {
        stop();
        return;
      }
      if (now >= cur.to) {
        const nextIdx = currentIdx + 1;
        const next = highlights[nextIdx];
        if (!next) {
          try {
            player.pauseVideo();
          } catch {
            /* swallow */
          }
          stop();
          return;
        }
        try {
          player.seekTo(next.from, true);
        } catch {
          stop();
          return;
        }
        expectedTimeRef.current = next.from;
        setCurrentIdx(nextIdx);
      }
    }, POLL_INTERVAL_MS);
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [active, currentIdx, highlights, playerRef, stop]);

  return {
    enabled,
    active,
    highlights,
    currentIdx,
    start,
    stop,
  };
}
