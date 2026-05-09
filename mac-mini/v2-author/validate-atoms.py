#!/usr/bin/env python3
"""
validate-atoms.py — post-LLM atom.timestamp_sec validator (CP446+).

Stage 1 only (Stage 2 text-marker matching removed 2026-05-09 — false-
positive rate too high for abstract atom.text). Spec:
  1. Extract every `[mm:ss]` marker from transcript -> sorted unique seconds.
  2. For each atom.timestamp_sec:
       - Find nearest marker.
       - |diff| <= 10s  -> snap atom.timestamp_sec to marker value.
       - |diff| >  10s  -> drop atom (reason=marker_drift_over_10s).
  3. ts > duration_seconds -> drop (reason=out_of_duration).
  4. Duplicate (video_id implicit, timestamp_sec) -> drop second occurrence
     (reason=duplicate_ts) — order-preserving.

Usage:
  validate-atoms.py [--diagnostic] <transcript_path> <v2_json_path> <duration_sec>

Input:
  transcript_path  — UTF-8 text with [mm:ss] cue markers (process-one.sh ytapi
                     or ytdlp output, see process-one.sh:88-115 for the awk
                     transformer that produces these).
  v2_json_path     — claude -p response after `jq -e .` validation passed.
  duration_sec     — youtube_videos.duration_seconds for the video, integer.
  --diagnostic     — emit per-atom telemetry under validation_meta.diagnostics
                     (used by the verification harness, not by prod).

Output (stdout):
  Mutated v2 JSON (same shape) with `segments.atoms` filtered + snapped, plus
  a top-level `validation_meta` object:
    {
      "atom_dropped_count": int,
      "drop_reasons": {
        "out_of_duration": int,
        "marker_drift_over_10s": int,
        "duplicate_ts": int
      },
      "atoms_in": int,
      "atoms_out": int,
      "snapped_count": int,
      "marker_count": int
    }

Output (stderr):
  Per-atom drop log, one JSON line per dropped atom:
    {"event": "drop", "reason": "...", "ts": int, "text": "first 80 chars"}

Exit:
  0 on success (even when all atoms dropped).
  1 on input parse error.

Don't touch:
  - core / analysis / lora — passed through unchanged.
  - segments.sections — passed through unchanged (separate spec scope).
  - Atom keys other than timestamp_sec — preserved (idx/type/text/entity_refs).
"""

import json
import re
import sys
from typing import Any

MARKER_SNAP_THRESHOLD_SEC = 10


def extract_markers(transcript: str) -> list[int]:
    """Parse every `[mm:ss]` marker; return sorted unique seconds list.
    Convention from process-one.sh awk: markers are emitted as `[d+:dd]`
    (no leading zero on minutes).
    """
    pattern = re.compile(r"\[(\d+):([0-5]\d)\]")
    seconds = set()
    for m in pattern.finditer(transcript):
        mm = int(m.group(1))
        ss = int(m.group(2))
        seconds.add(mm * 60 + ss)
    return sorted(seconds)


def nearest_marker(ts: int, markers: list[int]) -> tuple[int, int]:
    """Return (nearest_marker_value, abs_diff). Assumes markers sorted asc.
    For empty markers, returns (ts, 0) so the caller path collapses to no-op.
    """
    if not markers:
        return ts, 0
    lo, hi = 0, len(markers)
    while lo < hi:
        mid = (lo + hi) // 2
        if markers[mid] < ts:
            lo = mid + 1
        else:
            hi = mid
    candidates = []
    if lo > 0:
        candidates.append(markers[lo - 1])
    if lo < len(markers):
        candidates.append(markers[lo])
    best = min(candidates, key=lambda m: abs(m - ts))
    return best, abs(best - ts)


def log_drop(reason: str, ts: int, text: str) -> None:
    sys.stderr.write(
        json.dumps({"event": "drop", "reason": reason, "ts": ts, "text": text[:80]})
        + "\n"
    )


def validate_atoms(
    atoms: list[dict[str, Any]],
    markers: list[int],
    duration_sec: int,
    *,
    diagnostic_mode: bool = False,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Stage 1 (snap/drop on marker proximity + over-duration + dedup).
    Returns (new_atoms, validation_meta).

    When `diagnostic_mode=True`, validation_meta also carries a per-atom
    `diagnostics` array — used by the verification harness.
    """
    out: list[dict[str, Any]] = []
    seen_ts: set[int] = set()
    drop_reasons = {
        "out_of_duration": 0,
        "marker_drift_over_10s": 0,
        "duplicate_ts": 0,
    }
    snapped_count = 0
    atoms_in = len(atoms)
    diagnostics: list[dict[str, Any]] = []

    for atom in atoms:
        diag: dict[str, Any] = {
            "result": None,
            "original_ts": None,
            "snapped_ts": None,
            "final_ts": None,
            "atom_text_preview": str(atom.get("text", ""))[:60],
            "drop_reason": None,
        }

        ts_raw = atom.get("timestamp_sec")
        if not isinstance(ts_raw, int):
            try:
                ts_raw = int(ts_raw)
            except (TypeError, ValueError):
                log_drop("marker_drift_over_10s", -1, str(atom.get("text", "")))
                drop_reasons["marker_drift_over_10s"] += 1
                diag["result"] = "drop"
                diag["drop_reason"] = "marker_drift_over_10s"
                if diagnostic_mode:
                    diagnostics.append(diag)
                continue
        ts = ts_raw
        diag["original_ts"] = ts

        # Rule 3 (over duration)
        if duration_sec > 0 and ts > duration_sec:
            log_drop("out_of_duration", ts, str(atom.get("text", "")))
            drop_reasons["out_of_duration"] += 1
            diag["result"] = "drop"
            diag["drop_reason"] = "out_of_duration"
            if diagnostic_mode:
                diagnostics.append(diag)
            continue

        # Rule 1+2 (marker snap)
        snapped_ts = ts
        if markers:
            best, diff = nearest_marker(ts, markers)
            if diff > MARKER_SNAP_THRESHOLD_SEC:
                log_drop("marker_drift_over_10s", ts, str(atom.get("text", "")))
                drop_reasons["marker_drift_over_10s"] += 1
                diag["result"] = "drop"
                diag["drop_reason"] = "marker_drift_over_10s"
                if diagnostic_mode:
                    diagnostics.append(diag)
                continue
            if best != ts:
                snapped_ts = best
                snapped_count += 1
        diag["snapped_ts"] = snapped_ts

        # Rule 4 (dedup)
        if snapped_ts in seen_ts:
            log_drop("duplicate_ts", snapped_ts, str(atom.get("text", "")))
            drop_reasons["duplicate_ts"] += 1
            diag["result"] = "drop"
            diag["drop_reason"] = "duplicate_ts"
            if diagnostic_mode:
                diagnostics.append(diag)
            continue
        seen_ts.add(snapped_ts)

        new_atom = dict(atom)
        new_atom["timestamp_sec"] = snapped_ts
        out.append(new_atom)
        diag["result"] = "keep"
        diag["final_ts"] = snapped_ts
        if diagnostic_mode:
            diagnostics.append(diag)

    meta: dict[str, Any] = {
        "atom_dropped_count": atoms_in - len(out),
        "drop_reasons": drop_reasons,
        "atoms_in": atoms_in,
        "atoms_out": len(out),
        "snapped_count": snapped_count,
        "marker_count": len(markers),
    }
    if diagnostic_mode:
        meta["diagnostics"] = diagnostics
    return out, meta


def main() -> int:
    args = [a for a in sys.argv[1:] if a != "--diagnostic"]
    diagnostic_mode = "--diagnostic" in sys.argv
    if len(args) != 3:
        sys.stderr.write(
            "usage: validate-atoms.py [--diagnostic] <transcript_path> "
            "<v2_json_path> <duration_sec>\n"
        )
        return 1
    transcript_path, v2_json_path, dur_arg = args
    try:
        duration_sec = int(dur_arg)
    except ValueError:
        sys.stderr.write(f"duration_sec not an int: {dur_arg!r}\n")
        return 1

    try:
        with open(transcript_path, "r", encoding="utf-8") as f:
            transcript = f.read()
    except OSError as e:
        sys.stderr.write(f"transcript read failed: {e}\n")
        return 1

    try:
        with open(v2_json_path, "r", encoding="utf-8") as f:
            v2 = json.load(f)
    except (OSError, json.JSONDecodeError) as e:
        sys.stderr.write(f"v2 json read/parse failed: {e}\n")
        return 1

    markers = extract_markers(transcript)
    segments = v2.get("segments") or {}
    atoms = segments.get("atoms") if isinstance(segments, dict) else None
    if not isinstance(atoms, list):
        v2["validation_meta"] = {
            "atom_dropped_count": 0,
            "drop_reasons": {
                "out_of_duration": 0,
                "marker_drift_over_10s": 0,
                "duplicate_ts": 0,
            },
            "atoms_in": 0,
            "atoms_out": 0,
            "snapped_count": 0,
            "marker_count": len(markers),
        }
        json.dump(v2, sys.stdout, ensure_ascii=False)
        sys.stdout.write("\n")
        return 0

    new_atoms, meta = validate_atoms(
        atoms, markers, duration_sec, diagnostic_mode=diagnostic_mode
    )
    for new_idx, atom in enumerate(new_atoms, start=1):
        if "idx" in atom:
            atom["idx"] = new_idx

    segments["atoms"] = new_atoms
    v2["segments"] = segments
    v2["validation_meta"] = meta

    json.dump(v2, sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
