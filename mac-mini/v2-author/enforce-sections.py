#!/usr/bin/env python3
"""
enforce-sections.py — overwrite v2.segments.sections from chunks_meta
(CP446+, 2026-05-09).

After process-one.sh's claude -p call returns a v2 layered JSON, this
script forces the segments.sections array to match the algorithmic
chunks (chunk-transcript.py output). Only `idx`, `from_sec`, `to_sec`
are overwritten — `title` / `summary` from the LLM are preserved when
the section count matches; otherwise generated as fallbacks.

Why force-overwrite:
  Earlier prod measurement (5-video sample, 2026-05-09) showed LLM
  hallucinates section.from_sec/to_sec at ~55% rate. The chunking step
  produces marker-anchored boundaries that cannot be hallucinated.
  Forcing them ensures sections nav UI always points to real cue
  positions.

Args:
  enforce-sections.py <chunks_meta_path> <v2_json_path>

stdin: (none — v2 is read from <v2_json_path>)

stdout:
  Mutated v2 JSON (same shape) with segments.sections overwritten.

stderr:
  Telemetry: {event: 'sections_enforced', input_count, output_count,
              titles_preserved, mismatch}.

Exit:
  0 on success.
  1 on input parse / read failure.
"""

import json
import sys


def main() -> int:
    if len(sys.argv) != 3:
        sys.stderr.write(
            "usage: enforce-sections.py <chunks_meta_path> <v2_json_path>\n"
        )
        return 1
    chunks_meta_path, v2_json_path = sys.argv[1], sys.argv[2]

    try:
        with open(chunks_meta_path, "r", encoding="utf-8") as f:
            chunks = json.load(f)
        with open(v2_json_path, "r", encoding="utf-8") as f:
            v2 = json.load(f)
    except (OSError, json.JSONDecodeError) as e:
        sys.stderr.write(f"input read/parse failed: {e}\n")
        return 1

    segments = v2.get("segments")
    if not isinstance(segments, dict):
        segments = {"sections": [], "atoms": []}
        v2["segments"] = segments

    llm_sections = segments.get("sections")
    if not isinstance(llm_sections, list):
        llm_sections = []

    new_sections = []
    titles_preserved = 0
    mismatch = len(llm_sections) != len(chunks)
    for idx, ch in enumerate(chunks):
        # Preserve LLM title/summary ONLY when the section count exactly
        # matches — otherwise the LLM split disagrees with the algorithmic
        # boundaries and any positional carry-over would attach a title
        # describing the wrong time range.
        llm = (
            llm_sections[idx]
            if not mismatch
            and idx < len(llm_sections)
            and isinstance(llm_sections[idx], dict)
            else None
        )
        title = (
            llm.get("title")
            if llm and isinstance(llm.get("title"), str) and llm.get("title").strip()
            else f"Section {idx + 1}"
        )
        summary = llm.get("summary") if llm and isinstance(llm.get("summary"), str) else ""
        if llm:
            titles_preserved += 1
        new_sections.append(
            {
                "idx": idx,
                "from_sec": int(ch["from_sec"]),
                "to_sec": int(ch["to_sec"]),
                "title": title,
                "summary": summary,
            }
        )

    segments["sections"] = new_sections
    v2["segments"] = segments

    sys.stderr.write(
        json.dumps(
            {
                "event": "sections_enforced",
                "input_count": len(llm_sections),
                "output_count": len(new_sections),
                "titles_preserved": titles_preserved,
                "mismatch": mismatch,
            }
        )
        + "\n"
    )

    json.dump(v2, sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
