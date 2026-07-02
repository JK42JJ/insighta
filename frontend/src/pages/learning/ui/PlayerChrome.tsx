import { useEffect, useMemo, useRef } from 'react';
import { useLearningStore } from '../model/useLearningStore';
import { relevanceLevel, type RelevanceLevel } from '../lib/relevance-level';
import type { VideoRichSummarySection } from '@/shared/lib/api-client';

/**
 * Relevance curve overlay for the NATIVE YouTube player (user decision: the
 * curve is the ONLY custom element — every menu/control stays YouTube's).
 * A single pointer-events-none layer inside a `group/player relative` frame:
 * the curve appears WITH the native controls on hover, parked just above the
 * YT progress bar so both read as one navigator. High/mid/low chapters are
 * color-coded with a wide amplitude, the played portion is tinted gold, and
 * a playhead dot tracks the curve. Nothing here is clickable.
 */

interface PlayerChromeProps {
  sections: VideoRichSummarySection[];
}

const CURVE_W = 1000;
const CURVE_H = 100;
const BASE_Y = 92;
const GAP = 7;
// Wide amplitude (user directive: mockup's 26/48/66 read as a wobbly line).
const Y_FOR: Record<RelevanceLevel, number> = { high: 14, mid: 52, low: 84 };

interface Pt {
  x: number;
  y: number;
}

/** Catmull-Rom → cubic bézier path (mockup buildPath, verbatim math). */
function buildPath(pts: Pt[]): string {
  if (pts.length < 2) return '';
  const d = [`M${pts[0]!.x.toFixed(1)},${pts[0]!.y.toFixed(1)}`];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[i + 2] ?? pts[i + 1]!;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d.push(
      `C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`
    );
  }
  return d.join(' ');
}

function levelOf(s: VideoRichSummarySection): RelevanceLevel {
  return typeof s.relevance_pct === 'number' ? relevanceLevel(s.relevance_pct) : 'low';
}

export function PlayerChrome({ sections }: PlayerChromeProps) {
  const playerTimeSec = useLearningStore((s) => s.playerTimeSec);
  const playerDurationSec = useLearningStore((s) => s.playerDurationSec);

  const basePathRef = useRef<SVGPathElement>(null);
  const headRef = useRef<HTMLDivElement>(null);

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
  const progress = duration > 0 ? Math.min(1, Math.max(0, playerTimeSec / duration)) : 0;

  // Curve geometry (mockup renderRelCurve): one smooth curve; chapter
  // boundaries punched out by a clip; per-level color-coded stroke.
  const curve = useMemo(() => {
    if (!chapters.length || duration <= 0) return null;
    const pts: Pt[] = [{ x: 0, y: BASE_Y }];
    for (const c of chapters) {
      pts.push({ x: ((c.from_sec + c.to_sec) / 2 / duration) * CURVE_W, y: Y_FOR[levelOf(c)] });
    }
    pts.push({ x: CURVE_W, y: BASE_Y });
    const lineD = buildPath(pts);
    const gapRects = chapters.map((c, i) => {
      const x0 = i === 0 ? 0 : (c.from_sec / duration) * CURVE_W + GAP / 2;
      const x1 = i === chapters.length - 1 ? CURVE_W : (c.to_sec / duration) * CURVE_W - GAP / 2;
      return { x: x0, w: Math.max(0, x1 - x0) };
    });
    // Per-level color coding — high green / mid gold / low dim (user directive:
    // relevance must be identifiable from the curve alone).
    const gradStops = chapters.flatMap((c) => {
      const level = levelOf(c);
      const color = level === 'low' ? 'var(--lp-curve-neutral)' : `var(--lp-rel-${level})`;
      const op = level === 'high' ? 0.95 : level === 'mid' ? 0.75 : 0.35;
      return [
        { off: (c.from_sec / duration) * 100, color, op },
        { off: (c.to_sec / duration) * 100, color, op },
      ];
    });
    return { lineD, gapRects, gradStops };
  }, [chapters, duration]);

  // Playhead — walk the base path to the x of current progress (mockup paint).
  useEffect(() => {
    const base = basePathRef.current;
    const head = headRef.current;
    if (!base || !head || !curve) return;
    const svg = base.ownerSVGElement;
    if (!svg || typeof base.getTotalLength !== 'function') return;
    const W = svg.clientWidth;
    const H = svg.clientHeight;
    if (!W || !H) return;
    const targetX = progress * CURVE_W;
    const total = base.getTotalLength();
    let lo = 0;
    let hi = total;
    let pt = base.getPointAtLength(0);
    for (let k = 0; k < 20; k++) {
      const mid = (lo + hi) / 2;
      pt = base.getPointAtLength(mid);
      if (pt.x < targetX) lo = mid;
      else hi = mid;
    }
    head.style.left = `${progress * W}px`;
    head.style.top = `${(pt.y / CURVE_H) * H}px`;
  }, [progress, curve]);

  // Coverage gate — segments must actually map the video. A 65-min video
  // whose chapters cover only the first ~7 min would render as a squiggle
  // crammed into the left edge + a long flat line (user bug report): worse
  // than no curve. Hide unless the data spans ≥90% of the real duration.
  const coverage =
    duration > 0 && chapters.length ? chapters[chapters.length - 1]!.to_sec / duration : 0;
  if (!curve || coverage < 0.9) return null;

  return (
    // z-20 — must sit above PanelVideoPlayer's poster facade (z-10).
    <div className="pointer-events-none absolute inset-0 z-20" aria-hidden>
      {/* Relevance curve — fades in WITH the native controls (hover), parked
          just above the YT progress bar so the two read as one navigator. */}
      <div className="absolute bottom-[52px] left-3 right-3 h-[56px] opacity-0 transition-opacity duration-200 group-hover/player:opacity-100">
        <svg
          width="100%"
          height="56"
          viewBox={`0 0 ${CURVE_W} ${CURVE_H}`}
          preserveAspectRatio="none"
          className="block h-full w-full overflow-visible"
        >
          <defs>
            <clipPath id="lpRelProgClip">
              <rect x="0" y="0" width={progress * CURVE_W} height={CURVE_H} />
            </clipPath>
            <clipPath id="lpGapClip">
              {curve.gapRects.map((g, i) => (
                <rect key={i} x={g.x} y="0" width={g.w} height={CURVE_H} />
              ))}
            </clipPath>
            <linearGradient
              id="lpRelStroke"
              gradientUnits="userSpaceOnUse"
              x1="0"
              y1="0"
              x2={CURVE_W}
              y2="0"
            >
              {curve.gradStops.map((s, i) => (
                <stop
                  key={i}
                  offset={`${s.off.toFixed(2)}%`}
                  style={{ stopColor: s.color, stopOpacity: s.op }}
                />
              ))}
            </linearGradient>
          </defs>
          <g clipPath="url(#lpGapClip)">
            <path
              ref={basePathRef}
              d={curve.lineD}
              fill="none"
              stroke="url(#lpRelStroke)"
              strokeWidth={3}
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
            {/* var() doesn't resolve in SVG presentation attributes — style it. */}
            <path
              d={curve.lineD}
              fill="none"
              style={{ stroke: 'var(--lp-accent)' }}
              strokeWidth={3.5}
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              clipPath="url(#lpRelProgClip)"
            />
          </g>
        </svg>
        <div
          ref={headRef}
          className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white"
          style={{ boxShadow: 'var(--lp-head-glow)' }}
        />
      </div>
    </div>
  );
}
