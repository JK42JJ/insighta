// C' (figure warming) — pure selection of which (video, ts) to extract.
//
// Picks high-relevance segment timestamps to pre-extract into
// video_figure_snapshots, SPREAD across the mandala's cells (theme groups) so
// figures cover the book's chapters rather than concentrating in one crowded
// cell (e.g. 942 ch0 holds 33 videos). Caps per cell + per video to avoid
// over-extraction (numerize is expensive). Pure — no I/O; the script wrapper
// feeds it DB rows and turns the result into get-or-extract calls.

/** A high-relevance segment row (from video_mandala_segment_relevance). */
export interface RelSegment {
  videoId: string;
  fromSec: number;
  relevancePct: number;
}

export interface WarmSelectOpts {
  /** Minimum relevance to consider (default 80 — the figure-worthy band). */
  minRel?: number;
  /** Max videos to warm per cell (theme spread). Default 2. */
  perCellVideoCap?: number;
  /** Max timestamps to warm per video. Default 3. */
  perVideoTsCap?: number;
}

export interface WarmTarget {
  videoId: string;
  cellIndex: number;
  ts: number[];
}

/**
 * Select warm targets, spread across cells. cellByVideo maps a placed video to
 * its cell_index; segments without a known cell are dropped (can't place them
 * in a chapter). Returns at most perCellVideoCap videos per cell, each with up
 * to perVideoTsCap highest-relevance timestamps.
 */
export function selectWarmTargets(
  segments: RelSegment[],
  cellByVideo: Map<string, number>,
  opts: WarmSelectOpts = {}
): WarmTarget[] {
  const minRel = opts.minRel ?? 80;
  const perCellVideoCap = opts.perCellVideoCap ?? 2;
  const perVideoTsCap = opts.perVideoTsCap ?? 3;

  // 1. keep figure-worthy segments that belong to a known cell.
  const eligible = segments.filter((s) => s.relevancePct >= minRel && cellByVideo.has(s.videoId));

  // 2. group ts by video; track each video's best relevance + its cell.
  const perVideo = new Map<string, { cell: number; best: number; ts: number[] }>();
  for (const s of eligible) {
    const cell = cellByVideo.get(s.videoId)!;
    const v = perVideo.get(s.videoId) ?? { cell, best: 0, ts: [] };
    v.best = Math.max(v.best, s.relevancePct);
    if (!v.ts.includes(s.fromSec)) v.ts.push(s.fromSec);
    perVideo.set(s.videoId, v);
  }
  // cap + sort ts ascending per video.
  for (const v of perVideo.values()) {
    v.ts.sort((a, b) => a - b);
    v.ts = v.ts.slice(0, perVideoTsCap);
  }

  // 3. per cell, take the top perCellVideoCap videos by best relevance.
  const byCell = new Map<
    number,
    Array<{ videoId: string; cell: number; best: number; ts: number[] }>
  >();
  for (const [videoId, v] of perVideo) {
    const arr = byCell.get(v.cell) ?? [];
    arr.push({ videoId, ...v });
    byCell.set(v.cell, arr);
  }

  const out: WarmTarget[] = [];
  for (const [cell, vids] of Array.from(byCell.entries()).sort((a, b) => a[0] - b[0])) {
    vids.sort((a, b) => b.best - a.best);
    for (const v of vids.slice(0, perCellVideoCap)) {
      out.push({ videoId: v.videoId, cellIndex: cell, ts: v.ts });
    }
  }
  return out;
}
