/**
 * HoverFrameThumbnail — lightweight YouTube hover preview (NOT an iframe).
 *
 * While `active`, cycles through YouTube's official per-video still frames
 * (i.ytimg.com/vi/{id}/1.jpg → 2.jpg → 3.jpg ≈ early/mid/late scenes,
 * ~10-20KB each) to give a "moving preview" feel; on leave it snaps back to
 * the original thumbnail. Chosen over an iframe player on purpose: a real
 * player costs ~2-3MB JS + stream buffering per hover — wrong for a panel
 * the user sweep-scans (design decision, 2026-07-02).
 */
import { useEffect, useState } from 'react';
import { handleThumbnailError, handleThumbnailLoad } from '@/shared/lib/image-utils';

/** Delay before the cycle starts — avoids firing on incidental sweeps. */
const HOVER_START_DELAY_MS = 300;
/** Per-frame dwell time. */
const FRAME_INTERVAL_MS = 700;
/** YouTube official still-frame indices (1=early, 2=mid, 3=late). */
const FRAME_INDICES = [1, 2, 3] as const;

interface Props {
  videoId: string | null | undefined;
  thumbnail: string;
  active: boolean;
  className?: string;
}

export function HoverFrameThumbnail({ videoId, thumbnail, active, className }: Props) {
  // -1 = original thumbnail; 0..2 = FRAME_INDICES cursor.
  const [frame, setFrame] = useState(-1);

  useEffect(() => {
    if (!active || !videoId) {
      setFrame(-1);
      return;
    }
    let cursor = 0;
    const start = setTimeout(() => {
      setFrame(0);
      cursor = 0;
      intervalId = setInterval(() => {
        cursor = (cursor + 1) % FRAME_INDICES.length;
        setFrame(cursor);
      }, FRAME_INTERVAL_MS);
    }, HOVER_START_DELAY_MS);
    let intervalId: ReturnType<typeof setInterval> | undefined;
    return () => {
      clearTimeout(start);
      if (intervalId) clearInterval(intervalId);
      setFrame(-1);
    };
  }, [active, videoId]);

  const src =
    frame >= 0 && videoId
      ? `https://i.ytimg.com/vi/${videoId}/${FRAME_INDICES[frame]}.jpg`
      : thumbnail;

  return (
    <img
      src={src}
      alt=""
      className={className}
      loading="lazy"
      decoding="async"
      // A missing frame variant falls back to the original thumbnail
      // (official URLs, but stay defensive) — reuses the shared handler
      // only for the base thumbnail path.
      onError={(e) => {
        if (frame >= 0) {
          (e.currentTarget as HTMLImageElement).src = thumbnail;
        } else {
          handleThumbnailError(e);
        }
      }}
      onLoad={handleThumbnailLoad}
    />
  );
}
