import { useMemo } from 'react';
import { useLearningStore } from '../model/useLearningStore';
import { relevanceLevel, type RelevanceLevel } from '../lib/relevance-level';
import type { VideoRichSummarySection } from '@/shared/lib/api-client';

/**
 * Relevance heatmap for the NATIVE YouTube player — mockup B안, ported
 * verbatim (James, 2026-07-03, artifact b679917f): organic asymmetric
 * mounds whose tier-colored area encodes relevance, a soft dark scrim
 * behind them (the mockup's shade — without it the fills wash out over
 * bright footage), parked directly above the native progress bar.
 *
 * Geometry measured from the live 2026 embed UI (screenshot-calibrated):
 * progress bar top ≈ 74px above the player's bottom edge, side insets
 * ≈ 28px. Renders only after playback starts (pre-play the facade has no
 * bar for the strip to belong to). pointer-events-none throughout.
 */

interface PlayerChromeProps {
  sections: VideoRichSummarySection[];
  /** Playback engaged (facade dismissed / autoplay intent). Store telemetry
   *  alone breaks when the embed can't play (e.g. localhost YT block) —
   *  the strip would then never appear with zero diagnosis. */
  engaged?: boolean;
}

const STRIP_W = 1000;
const STRIP_H = 26;
/** Plateau top y per tier → mound heights 22 / 17 / 12 (mockup spec). */
const Y_FOR: Record<RelevanceLevel, number> = { high: 4, mid: 9, low: 14 };
/** Mockup B fill gradients: [top, bottom] opacity per tier. */
const FILL_OPACITY: Record<RelevanceLevel, [number, number]> = {
  high: [0.55, 0.08],
  mid: [0.5, 0.07],
  low: [0.38, 0.05],
};
const GAP = 4;
/** Measured 2026 embed UI: bar top ≈74px above bottom, ≈28px side insets. */
const STRIP_BOTTOM_PX = 74;
const STRIP_INSET_PX = 28;
/** Scrim above the strip so tier colors read over bright footage (mockup
 *  .shade). Stops AT the strip base — never dims the native controls. */
const SCRIM_EXTRA_PX = 82;

function levelOf(s: VideoRichSummarySection): RelevanceLevel {
  return typeof s.relevance_pct === 'number' ? relevanceLevel(s.relevance_pct) : 'low';
}

/** Organic mound path (mockup B language): soft rise from the left edge,
 *  plateau near the right, slight settle at the exit edge. */
function moundPath(x0: number, x1: number, y: number): string {
  const w = x1 - x0;
  const edgeInY = Math.min(STRIP_H - 4, y + 6);
  const edgeOutY = Math.min(STRIP_H - 4, y + 2);
  const c = (f: number) => (x0 + w * f).toFixed(1);
  return [
    `M${x0.toFixed(1)},${STRIP_H}`,
    `L${x0.toFixed(1)},${edgeInY}`,
    `C${c(0.25)},${y + 2} ${c(0.5)},${y} ${c(0.72)},${y}`,
    `C${c(0.88)},${y} ${x1.toFixed(1)},${y + 1} ${x1.toFixed(1)},${edgeOutY}`,
    `L${x1.toFixed(1)},${STRIP_H}`,
    'Z',
  ].join(' ');
}

export function PlayerChrome({ sections, engaged = false }: PlayerChromeProps) {
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

  const mounds = useMemo(() => {
    if (!chapters.length || duration <= 0) return [];
    const last = chapters.length - 1;
    return chapters.flatMap((c, i) => {
      const x0 = (c.from_sec / duration) * STRIP_W + (i === 0 ? 0 : GAP / 2);
      const x1 = (c.to_sec / duration) * STRIP_W - (i === last ? 0 : GAP / 2);
      if (x1 - x0 < 3) return [];
      const level = levelOf(c);
      return [{ d: moundPath(x0, x1, Y_FOR[level]), level, key: `${c.from_sec}-${i}` }];
    });
  }, [chapters, duration]);

  // Coverage gate — hide when segments don't actually map the video.
  const coverage =
    duration > 0 && chapters.length ? chapters[chapters.length - 1]!.to_sec / duration : 0;

  // Pre-play there is no native bar for the strip to belong to (user report:
  // mounds floating alone on the poster read as noise).
  const started = engaged || playerState === 'playing' || playerTimeSec > 0;
  if (!started || !mounds.length || coverage < 0.9) return null;

  return (
    // z-20 — must sit above PanelVideoPlayer's poster facade (z-10).
    <div className="pointer-events-none absolute inset-0 z-20" aria-hidden>
      <div className="opacity-0 transition-opacity duration-200 group-hover/player:opacity-100">
        {/* Scrim (mockup .shade) — fades from the strip's base upward; the
            native control zone below stays untouched. */}
        <div
          className="absolute left-0 right-0"
          style={{
            bottom: STRIP_BOTTOM_PX,
            height: STRIP_H + SCRIM_EXTRA_PX,
            background: 'linear-gradient(to top, rgba(0,0,0,0.55), rgba(0,0,0,0))',
          }}
        />
        {/* Heatmap strip — same width as the native progress bar. */}
        <div
          className="absolute"
          style={{
            bottom: STRIP_BOTTOM_PX,
            left: STRIP_INSET_PX,
            right: STRIP_INSET_PX,
            height: STRIP_H,
          }}
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
            {mounds.map((p) => (
              <path key={p.key} d={p.d} fill={`url(#lpRelFill-${p.level})`} />
            ))}
          </svg>
        </div>
      </div>
    </div>
  );
}
