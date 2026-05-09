#!/usr/bin/env python3
"""
chunk-transcript.py — algorithmic transcript chunking (CP446+, 2026-05-09).

Splits a [mm:ss]-marked transcript into chunks at:
  - marker gap >= GAP_THRESHOLD_SEC (large pause between cues), OR
  - elapsed_in_chunk >= MAX_DURATION_SEC (5-min cap by default)
whichever fires first. If chunk count < MIN_CHUNKS, retries with the
fallback max_dur (180s default).

Why algorithmic and not LLM:
  Earlier prod measurement (5-video sample, 2026-05-09) showed LLM
  hallucinates section.from_sec/to_sec at ~55% rate (round numbers
  unrelated to actual transcript markers). Chunk boundaries from
  raw [mm:ss] markers cannot be hallucinated — they are extracted
  verbatim from the transcript file.

Spec defaults (chosen from the same 5-video sample):
  GAP_THRESHOLD_SEC = 15  (median cue gap 2-4s, p95 5-8s; 15s = clear
                           topic-break boundary, not micro-silence)
  MAX_DURATION_SEC  = 300 (5-min cap so very-active sections don't run
                           into single 60-min chunks)
  MIN_CHUNKS        = 3   (downstream sections nav needs > 1)
  FALLBACK_MAX_SEC  = 180 (3-min cap when min_chunks fails)

Args:
  chunk-transcript.py <transcript_in> <tagged_out> <chunks_meta_out>
                      [--gap=15] [--max=300]
                      [--min-chunks=3] [--fallback-max=180]

Outputs:
  <tagged_out>      — transcript with [SECTION N: from_sec ~ to_sec]
                       block markers inserted between chunks. The block
                       header MUST match the chunks_meta exactly so the
                       downstream prompt can refer to it.
  <chunks_meta_out> — JSON: [{idx, from_sec, to_sec, text_len, cue_count}, ...]
                       Used by enforce-sections.py to overwrite
                       hallucinated LLM segments.sections after the
                       v2-author claude -p response.

Exit:
  0 on success.
  1 on input parse / write failure.
"""

import argparse
import json
import re
import sys

CUE_RE = re.compile(r"^\[(\d+):([0-5]\d)\]\s*(.*)$")


def parse_cues(text: str) -> list[tuple[int, str]]:
    """Parse `[mm:ss] text` lines into (sec, text) tuples in order."""
    cues: list[tuple[int, str]] = []
    for line in text.splitlines():
        m = CUE_RE.match(line.rstrip())
        if not m:
            continue
        sec = int(m.group(1)) * 60 + int(m.group(2))
        cues.append((sec, m.group(3)))
    return cues


def chunk_cues(
    cues: list[tuple[int, str]], gap_sec: int, max_dur_sec: int
) -> list[tuple[int, int, list[tuple[int, str]]]]:
    """Split cues at gap >= gap_sec OR elapsed >= max_dur_sec.
    Returns list of (from_sec, to_sec, cue_slice).
      from_sec = cues[start][0]
      to_sec   = cues[next_chunk_start][0]   # boundary, exclusive
                 = cues[-1][0] for the final chunk
    """
    if not cues:
        return []
    out: list[tuple[int, int, list[tuple[int, str]]]] = []
    start = 0
    start_sec = cues[0][0]
    for i in range(1, len(cues)):
        gap = cues[i][0] - cues[i - 1][0]
        elapsed = cues[i - 1][0] - start_sec
        if gap >= gap_sec or elapsed >= max_dur_sec:
            out.append((start_sec, cues[i][0], cues[start:i]))
            start = i
            start_sec = cues[i][0]
    out.append((start_sec, cues[-1][0], cues[start:]))
    return out


def build_tagged_transcript(
    chunks: list[tuple[int, int, list[tuple[int, str]]]],
) -> str:
    """Reconstruct the transcript with [SECTION N: from_sec ~ to_sec]
    headers between cue groups. Each chunk's cues are emitted as their
    original `[mm:ss] text` lines so the LLM still has per-cue marker
    visibility within each section.
    """
    lines: list[str] = []
    for idx, (from_sec, to_sec, slice_) in enumerate(chunks):
        lines.append(f"[SECTION {idx}: {from_sec}s ~ {to_sec}s]")
        for sec, text in slice_:
            mm, ss = sec // 60, sec % 60
            lines.append(f"[{mm}:{ss:02d}] {text}")
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def chunks_meta(
    chunks: list[tuple[int, int, list[tuple[int, str]]]],
) -> list[dict]:
    return [
        {
            "idx": idx,
            "from_sec": from_sec,
            "to_sec": to_sec,
            "cue_count": len(slice_),
            "text_len": sum(len(t) for _, t in slice_),
        }
        for idx, (from_sec, to_sec, slice_) in enumerate(chunks)
    ]


def main() -> int:
    parser = argparse.ArgumentParser(add_help=True)
    parser.add_argument("transcript_in")
    parser.add_argument("tagged_out")
    parser.add_argument("chunks_meta_out")
    parser.add_argument("--gap", type=int, default=15)
    parser.add_argument("--max", type=int, default=300)
    parser.add_argument("--min-chunks", type=int, default=3)
    parser.add_argument("--fallback-max", type=int, default=180)
    args = parser.parse_args()

    try:
        with open(args.transcript_in, "r", encoding="utf-8") as f:
            transcript = f.read()
    except OSError as e:
        sys.stderr.write(f"transcript read failed: {e}\n")
        return 1

    cues = parse_cues(transcript)
    if not cues:
        sys.stderr.write("no cues parsed (transcript missing [mm:ss] markers)\n")
        return 1

    chunks = chunk_cues(cues, args.gap, args.max)
    fallback_used = False
    if len(chunks) < args.min_chunks:
        chunks = chunk_cues(cues, args.gap, args.fallback_max)
        fallback_used = True

    tagged = build_tagged_transcript(chunks)
    meta = chunks_meta(chunks)

    try:
        with open(args.tagged_out, "w", encoding="utf-8") as f:
            f.write(tagged)
        with open(args.chunks_meta_out, "w", encoding="utf-8") as f:
            json.dump(meta, f, ensure_ascii=False)
            f.write("\n")
    except OSError as e:
        sys.stderr.write(f"output write failed: {e}\n")
        return 1

    # Telemetry to stderr (process-one.sh swallows; useful for forensic logs).
    sys.stderr.write(
        json.dumps(
            {
                "event": "chunked",
                "cue_count": len(cues),
                "chunk_count": len(chunks),
                "gap_sec": args.gap,
                "max_dur_sec": args.fallback_max if fallback_used else args.max,
                "fallback_used": fallback_used,
            }
        )
        + "\n"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
