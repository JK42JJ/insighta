#!/usr/bin/env python3
"""
fetch-transcript.py — youtube-transcript-api wrapper for v2-author batch.

CP446+ (2026-05-09): multi-language fallback. Earlier prod measurement
on a 1,296-row backfill queue showed 96.7% (1,253) failed with the
single-language `languages=[lang]` call when the requested lang's
transcript wasn't available, even when other languages WERE present.

Spec (user 2026-05-09):
  Try in order, dedup-preserving:
    1. source_language        manual
    2. ko                     manual
    3. en                     manual
    4. ko                     auto-generated
    5. en                     auto-generated
  First success → return that transcript + log the (lang, kind) used.
  All fail → rc=1 (same as legacy single-lang behavior).

Args: vid (positional), source_lang (positional default 'ko')
Stdout: plain transcript text (≤ 30000 chars), [mm:ss] line-prefixed.
Stderr: per-attempt notes + final selection (or failure summary).
Exit: 0 on success, 1 on no caption / too short.

Don't touch:
  - The [mm:ss] marker convention from process-one.sh:88-115.
  - core / analysis / lora — this script only owns transcript fetch.
  - WebShare proxy: retired CP438+1 + creds exhausted as of 2026-05-09.
"""
import sys

try:
    from youtube_transcript_api import YouTubeTranscriptApi
except ImportError:
    sys.stderr.write("ImportError: youtube-transcript-api not installed.\n")
    sys.stderr.write("Install: pip3 install --user youtube-transcript-api\n")
    sys.exit(2)


def emit(snippets, vid: str, used_lang: str, used_kind: str) -> int:
    """Convert snippet list to [mm:ss] prefixed lines and print."""
    parts = []
    for s in snippets:
        sec = int(s.start) if hasattr(s, "start") else 0
        mm = sec // 60
        ss = sec % 60
        parts.append(f"[{mm}:{ss:02d}] {s.text}")
    text = "\n".join(parts)
    if len(text) < 200:
        sys.stderr.write(
            f"transcript too short: {len(text)} chars (lang={used_lang} kind={used_kind})\n"
        )
        return 1
    sys.stderr.write(f"fetched lang={used_lang} kind={used_kind} chars={len(text)}\n")
    print(text[:30000])
    return 0


def main() -> int:
    if len(sys.argv) < 2:
        sys.stderr.write("usage: fetch-transcript.py <video_id> [source_lang]\n")
        return 2
    vid = sys.argv[1]
    source_lang = sys.argv[2] if len(sys.argv) > 2 else "ko"

    # Build attempt list per spec, dedup-preserving (lang, kind) pair.
    raw_attempts = [
        (source_lang, "manual"),
        ("ko", "manual"),
        ("en", "manual"),
        ("ko", "auto"),
        ("en", "auto"),
    ]
    seen = set()
    attempts = []
    for lang, kind in raw_attempts:
        key = f"{lang}:{kind}"
        if key in seen:
            continue
        seen.add(key)
        attempts.append((lang, kind))

    api = YouTubeTranscriptApi()

    # Step 1: list() once — used by both manual and auto attempts.
    # Some failure modes (RequestBlocked / IpBlocked / TranscriptsDisabled)
    # surface here and abort cleanly without per-attempt retries.
    try:
        transcript_list = api.list(vid)
    except Exception as e:
        sys.stderr.write(f"list failed: {type(e).__name__}: {str(e)[:200]}\n")
        return 1

    available = []
    try:
        for t in transcript_list:
            available.append((t.language_code, "auto" if t.is_generated else "manual"))
    except Exception as e:
        sys.stderr.write(f"list iter failed: {type(e).__name__}: {str(e)[:120]}\n")
        return 1

    sys.stderr.write(
        f"available: {','.join(f'{l}:{k}' for l, k in available) or '(none)'}\n"
    )
    if not available:
        return 1

    # Per-attempt: try TranscriptList.find_*_transcript when API supports it,
    # falling back to api.fetch(languages=[lang]) when only that's available.
    # The newer API exposes find_transcript and find_generated_transcript on
    # the TranscriptList object; test once.
    has_find_manual = hasattr(transcript_list, "find_manually_created_transcript")
    has_find_auto = hasattr(transcript_list, "find_generated_transcript")

    last_err = None
    for lang, kind in attempts:
        # Skip attempt if list confirms (lang, kind) absent — saves a roundtrip.
        if (lang, kind) not in available:
            continue
        try:
            if kind == "manual" and has_find_manual:
                t = transcript_list.find_manually_created_transcript([lang])
                fetched = t.fetch()
                snippets = list(fetched)
            elif kind == "auto" and has_find_auto:
                t = transcript_list.find_generated_transcript([lang])
                fetched = t.fetch()
                snippets = list(fetched)
            else:
                # Fallback: api.fetch returns either manual or auto for the
                # requested lang. Filter by post-fetch is_generated to keep
                # spec parity (manual attempt MUST yield manual, etc).
                result = api.fetch(vid, languages=[lang])
                is_gen = bool(getattr(result, "is_generated", False))
                if (kind == "manual") == is_gen:
                    last_err = f"{lang}:{kind} fetch returned wrong kind"
                    continue
                snippets = list(result.snippets)
            return emit(snippets, vid, lang, kind)
        except Exception as e:
            last_err = f"{lang}:{kind}: {type(e).__name__}: {str(e)[:80]}"
            sys.stderr.write(f"attempt {lang}:{kind} failed: {last_err}\n")
            continue

    sys.stderr.write(
        f"all attempts failed (last: {last_err}). available={available}\n"
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())
