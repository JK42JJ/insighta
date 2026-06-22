// D (figure → /slides/build) — pure mapping from a cached snapshot row to the
// build-service figures[] contract. No I/O. The build-call site (POST
// /slides/build) does not exist yet (slidegen endpoint pending); this module
// only produces the payload it will carry, so it is unit-testable in isolation.
//
// Build contract (agreed with slidegen): figures[] = { figure_id, kind, struct?,
// latex?, png_url?, ts }. Field gaps vs video_figure_snapshots:
//   - figure_id: snapshots have no id column (PK = video_id+ts_sec+kind) →
//     synthesized as `${video_id}:${ts_sec}:${kind}`.
//   - png_url:   snapshots store keyframe binary pointer in asset_path (deferred,
//     usually null) → passed through; struct/latex figures don't need it.

import type { FigureKind } from './types';

/** A single video_figure_snapshots row (the columns this mapping reads). */
export interface SnapshotRow {
  video_id: string;
  ts_sec: number;
  kind: string;
  struct: unknown | null;
  latex: string | null;
  asset_path: string | null;
}

/** One figure in the /slides/build request payload. */
export interface BuildFigure {
  figure_id: string;
  video_id: string;
  ts: number;
  kind: FigureKind;
  struct?: unknown;
  latex?: string;
  png_url?: string | null;
}

/** Synthesize the build figure_id (snapshots have no id column). */
export function snapshotFigureId(videoId: string, tsSec: number, kind: string): string {
  return `${videoId}:${tsSec}:${kind}`;
}

/** Map one snapshot row to a BuildFigure (pure). Only payload that exists is set. */
export function snapshotRowToBuildFigure(row: SnapshotRow): BuildFigure {
  return {
    figure_id: snapshotFigureId(row.video_id, row.ts_sec, row.kind),
    video_id: row.video_id,
    ts: row.ts_sec,
    kind: row.kind as FigureKind,
    ...(row.struct != null ? { struct: row.struct } : {}),
    ...(row.latex != null ? { latex: row.latex } : {}),
    // asset_path is the keyframe binary pointer (deferred, often null) → png_url.
    ...(row.asset_path != null ? { png_url: row.asset_path } : {}),
  };
}
