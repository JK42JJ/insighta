import { useMemo } from 'react';
import { useLearningStore } from '../model/useLearningStore';
import { relevanceLevel, type RelevanceLevel } from '../lib/relevance-level';
import type { VideoRichSummarySection } from '@/shared/lib/api-client';

/**
 * Relevance heatmap for the NATIVE YouTube player — mockup B안 (James pick,
 * 2026-07-03, artifact b679917f). Borrows the grammar of YouTube's own
 * "most replayed" graph: a 26px strip parked DIRECTLY ABOVE the progress
 * bar (never overlapping it or the video content), fading in/out with the
 * native controls on hover. Each chapter is a rounded plateau whose height
 * and tier-colored area encode relevance (high green / mid gold / low dim).
 * pointer-events-none — the ONLY custom element on the player.
 */

interface PlayerChromeProps {
  sections: VideoRichSummarySection[];
}

const STRIP_W = 1000;
const STRIP_H = 26;
/** Plateau top y per tier → heights 22 / 17 / 12 (mockup spec). */
const Y_FOR: Record<RelevanceLevel, number> = { high: 4, mid: 9, low: 14 };
/** Area-fill opacities per tier: [top, bottom] of the vertical gradient. */
const FILL_OPACITY: Record<RelevanceLevel, [number, number]> = {
  high: [0.55, 0.08],
  mid: [0.5, 0.07],
  low: [0.38, 0.05],
};
/** Gap between chapters (viewBox units ≈ px at typical player width). */
const GAP = 4;
/** Rounded shoulder radius cap. */
const SHOULDER_R = 14;
/** YT progress bar geometry: 12px side padding; bar top edge ≈ 52px above
 *  the player's bottom edge (48px control row + 3px bar + 1px breathing). */
const STRIP_BOTTOM_PX = 52;

function levelOf(s: VideoRichSummarySection): RelevanceLevel {
  return typeof s.relevance_pct === 'number' ? relevanceLevel(s.relevance_pct) : 'low';
}

/** Rounded-shoulder plateau area path for one chapter. */
function plateauPath(x0: number, x1: number, y: number): string {
  const w = x1 - x0;
  const r = Math.min(SHOULDER_R, w / 3);
  const shoulderY = Math.min(STRIP_H, y + 6);
  return [
    `M${x0.toFixed(1)},${STRIP_H}`,
    `L${x0.toFixed(1)},${shoulderY}`,
    `Q${x0.toFixed(1)},${y} ${(x0 + r).toFixed(1)},${y}`,
    `L${(x1 - r).toFixed(1)},${y}`,
    `Q${x1.toFixed(1)},${y} ${x1.toFixed(1)},${shoulderY}`,
    `L${x1.toFixed(1)},${STRIP_H}`,
    'Z',
  ].join(' ');
}

export function PlayerChrome({ sections }: PlayerChromeProps) {
  const playerDurationSec = useLearningStore((s) => s.playerDurationSec);
  const playerState = useLearningStore((s) => s.playerState);
  const playerTimeSec = useLearningStore((s) => s.playerTimeSec);

  const chapters = useMemo(
    () =>
      sections
        .filter((s) => s.to_sec > s.from_sec)
        .slice()
        .sort((a, b) => a.from_sec - b.from_sec),
    [sections]
  );
  const duration =
    playerDurationSec > 0 ? playerDurationSec : (chapters[chapters.length - 1]?.to_sec ?? 0);

  const plateaus = useMemo(() => {
    if (!chapters.length || duration <= 0) return [];
    const last = chapters.length - 1;
    return chapters.flatMap((c, i) => {
      const x0 = (c.from_sec / duration) * STRIP_W + (i === 0 ? 0 : GAP / 2);
      const x1 = (c.to_sec / duration) * STRIP_W - (i === last ? 0 : GAP / 2);
      if (x1 - x0 < 3) return [];
      const level = levelOf(c);
      return [{ d: plateauPath(x0, x1, Y_FOR[level]), level, key: `${c.from_sec}-${i}` }];
    });
  }, [chapters, duration]);

  // Coverage gate — segments must actually map the video (a 65-min video
  // whose chapters cover only the first ~7 min would render one sliver +
  // emptiness: worse than nothing). Hide below 90% real-duration coverage.
  const coverage =
    duration > 0 && chapters.length ? chapters[chapters.length - 1]!.to_sec / duration : 0;

  // Pre-play the poster facade has NO progress bar or controls — the strip
  // floating alone on a thumbnail reads as noise (user report vs mockup).
  // The heatmap belongs to the control cluster: render it only once
  // playback has started, so it always appears WITH the native bar.
  const started = playerState === 'playing' || playerTimeSec > 0;
  if (!started || !plateaus.length || coverage < 0.9) return null;

  return (
    // z-20 — must sit above PanelVideoPlayer's poster facade (z-10).
    <div className="pointer-events-none absolute inset-0 z-20" aria-hidden>
      {/* 26px strip directly above the YT progress bar (12px side padding =
          the bar's own inset). Fades with the native controls on hover. */}
      <div
        className="absolute left-3 right-3 opacity-0 transition-opacity duration-200 group-hover/player:opacity-100"
        style={{ bottom: STRIP_BOTTOM_PX, height: STRIP_H }}
      >
        <svg
          width="100%"
          height={STRIP_H}
          viewBox={`0 0 ${STRIP_W} ${STRIP_H}`}
          preserveAspectRatio="none"
          className="block h-full w-full"
        >
          <defs>
            {(['high', 'mid', 'low'] as const).map((level) => (
              <linearGradient key={level} id={`lpRelFill-${level}`} x1="0" y1="0" x2="0" y2="1">
                {/* var() doesn't resolve in SVG presentation attrs — style it. */}
                <stop
                  offset="0"
                  style={{
                    stopColor: `var(--lp-rel-${level})`,
                    stopOpacity: FILL_OPACITY[level][0],
                  }}
                />
                <stop
                  offset="1"
                  style={{
                    stopColor: `var(--lp-rel-${level})`,
                    stopOpacity: FILL_OPACITY[level][1],
                  }}
                />
              </linearGradient>
            ))}
          </defs>
          {plateaus.map((p) => (
            <path key={p.key} d={p.d} fill={`url(#lpRelFill-${p.level})`} />
          ))}
        </svg>
      </div>
    </div>
  );
}
