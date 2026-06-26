/**
 * atom-marker-snap.ts — server-side timestamp validator (CP504).
 *
 * Port of the Mac Mini `validate-atoms.py` (CP446+) that CP488 dropped from the
 * `process-one.sh` fork — leaving claude -p's hallucinated atom timestamps
 * unguarded (the upsert-direct route only *clamps* to duration, which caps a
 * wrong value instead of correcting it). Moving the guard server-side makes it
 * the SSOT for EVERY client (Mac Mini bulk / prod cron / inline) so it cannot
 * silently go missing per-client again.
 *
 * Spec (atoms — faithful to validate-atoms.py):
 *   1. Extract every `[mm:ss]` marker from the transcript → sorted unique secs.
 *   2. For each atom.timestamp_sec:
 *        - ts > duration            → DROP (out_of_duration)
 *        - nearest marker |diff|≤10 → SNAP atom.timestamp_sec to the marker
 *        - nearest marker |diff|>10 → DROP (marker_drift_over_10s)
 *        - duplicate snapped ts     → DROP second occurrence (duplicate_ts)
 *   3. Sort surviving atoms ascending by timestamp_sec + re-index idx (the py
 *      version preserved order; the model is required to emit ascending, so we
 *      additionally guarantee it here — SNAP can reorder near-equal values).
 *
 * Spec (sections — light alignment, the py version left sections untouched):
 *   Snap from_sec/to_sec to the nearest marker, clamp into [0, duration], and
 *   keep boundaries monotonically non-decreasing (first from_sec forced to 0).
 *   This stops the "sections run past the video / overlap" artefact without the
 *   removed chunk-transcript.py pre-split.
 *
 * When the transcript is empty or has no markers, atoms/sections pass through
 * unchanged (we cannot SNAP without ground-truth markers).
 */

const MARKER_SNAP_THRESHOLD_SEC = 10;

export interface AtomSnapMeta {
  atom_dropped_count: number;
  drop_reasons: {
    out_of_duration: number;
    marker_drift_over_10s: number;
    duplicate_ts: number;
  };
  atoms_in: number;
  atoms_out: number;
  snapped_count: number;
  marker_count: number;
  sections_aligned: number;
}

/** Parse every `[mm:ss]` (or `[h:mm:ss]` is emitted as `[mm:ss]` past an hour by
 * the awk transformer — minutes can exceed 59) marker → sorted unique seconds. */
export function extractMarkers(transcript: string): number[] {
  const re = /\[(\d+):([0-5]\d)\]/g;
  const set = new Set<number>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(transcript)) !== null) {
    set.add(parseInt(m[1]!, 10) * 60 + parseInt(m[2]!, 10));
  }
  return Array.from(set).sort((a, b) => a - b);
}

/** Nearest marker (binary search on a sorted asc array) + abs diff. */
function nearestMarker(ts: number, markers: number[]): { value: number; diff: number } {
  if (markers.length === 0) return { value: ts, diff: 0 };
  let lo = 0;
  let hi = markers.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (markers[mid]! < ts) lo = mid + 1;
    else hi = mid;
  }
  const cands: number[] = [];
  if (lo > 0) cands.push(markers[lo - 1]!);
  if (lo < markers.length) cands.push(markers[lo]!);
  let best = cands[0]!;
  for (const c of cands) if (Math.abs(c - ts) < Math.abs(best - ts)) best = c;
  return { value: best, diff: Math.abs(best - ts) };
}

interface AtomLike {
  idx?: number;
  timestamp_sec?: number | null;
  [k: string]: unknown;
}
interface SectionLike {
  from_sec?: number | null;
  to_sec?: number | null;
  [k: string]: unknown;
}

/**
 * SNAP/drop atoms + align sections against the transcript markers. Returns a
 * deep-cloned segments object (input untouched) + telemetry meta. If `segments`
 * is not a usable object, returns it unchanged with a zeroed meta.
 */
export function snapSegmentsToMarkers(
  segments: unknown,
  transcript: string,
  durationSec: number | null
): { segments: unknown; meta: AtomSnapMeta } {
  const markers = extractMarkers(transcript);
  const meta: AtomSnapMeta = {
    atom_dropped_count: 0,
    drop_reasons: { out_of_duration: 0, marker_drift_over_10s: 0, duplicate_ts: 0 },
    atoms_in: 0,
    atoms_out: 0,
    snapped_count: 0,
    marker_count: markers.length,
    sections_aligned: 0,
  };

  if (!segments || typeof segments !== 'object') return { segments, meta };
  const seg = JSON.parse(JSON.stringify(segments)) as {
    atoms?: AtomLike[];
    sections?: SectionLike[];
  };

  // ── atoms ───────────────────────────────────────────────────────────────
  if (Array.isArray(seg.atoms)) {
    const atoms = seg.atoms;
    meta.atoms_in = atoms.length;
    const seen = new Set<number>();
    const kept: AtomLike[] = [];
    for (const atom of atoms) {
      let ts = atom.timestamp_sec;
      if (typeof ts !== 'number' || !Number.isFinite(ts)) {
        const n = Number(ts);
        if (!Number.isFinite(n)) {
          meta.drop_reasons.marker_drift_over_10s++;
          continue;
        }
        ts = n;
      }
      ts = Math.floor(ts);
      // Rule 3 — over duration
      if (typeof durationSec === 'number' && durationSec > 0 && ts > durationSec) {
        meta.drop_reasons.out_of_duration++;
        continue;
      }
      // Rule 1+2 — marker snap / drift drop
      let snapped = ts;
      if (markers.length > 0) {
        const { value, diff } = nearestMarker(ts, markers);
        if (diff > MARKER_SNAP_THRESHOLD_SEC) {
          meta.drop_reasons.marker_drift_over_10s++;
          continue;
        }
        if (value !== ts) {
          snapped = value;
          meta.snapped_count++;
        }
      }
      // Rule 4 — dedup
      if (seen.has(snapped)) {
        meta.drop_reasons.duplicate_ts++;
        continue;
      }
      seen.add(snapped);
      kept.push({ ...atom, timestamp_sec: snapped });
    }
    // ascending + re-index
    kept.sort((a, b) => (a.timestamp_sec as number) - (b.timestamp_sec as number));
    kept.forEach((a, i) => {
      a.idx = i;
    });
    seg.atoms = kept;
    meta.atoms_out = kept.length;
    meta.atom_dropped_count = meta.atoms_in - kept.length;
  }

  // ── sections (light marker alignment + monotonic clamp) ───────────────────
  if (Array.isArray(seg.sections) && markers.length > 0) {
    const cap = typeof durationSec === 'number' && durationSec > 0 ? durationSec : Infinity;
    let prevTo = 0;
    seg.sections.forEach((s, i) => {
      const snap = (v: number | null | undefined): number | null => {
        if (typeof v !== 'number' || !Number.isFinite(v)) return null;
        const { value, diff } = nearestMarker(Math.floor(v), markers);
        return Math.min(cap, diff <= MARKER_SNAP_THRESHOLD_SEC ? value : Math.floor(v));
      };
      let from = i === 0 ? 0 : (snap(s.from_sec) ?? prevTo);
      let to = snap(s.to_sec) ?? from;
      if (from < prevTo) from = prevTo;
      if (to < from) to = from;
      if (s.from_sec !== from || s.to_sec !== to) meta.sections_aligned++;
      s.from_sec = from;
      s.to_sec = to;
      prevTo = to;
    });
  }

  return { segments: seg, meta };
}
