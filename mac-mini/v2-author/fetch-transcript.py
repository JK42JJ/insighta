#!/usr/bin/env python3
"""
CP438+1 Q6 (2026-05-03): yt-dlp+WebShare replacement for v2-author batch.

Fetches YouTube auto-captions via the official web-client API used by
youtube-transcript-api. No proxy needed — direct from Mac Mini IP.

Why: WebShare account ran out of credits → all yt-dlp calls returned
402 Payment Required → all videos returned no_caption regardless of
whether captions actually existed. This script bypasses the proxy
chain entirely.

Args: vid (positional), lang (positional default 'ko')
Stdout: plain transcript text (≤ 30000 chars), single-line joined.
Stderr: error class + message on failure.
Exit: 0 on success (transcript ≥ 200 chars), 1 on no caption / too short.

Usage:
  python3 fetch-transcript.py <video_id> [lang]
"""
import sys

try:
    from youtube_transcript_api import YouTubeTranscriptApi
except ImportError:
    sys.stderr.write("ImportError: youtube-transcript-api not installed.\n")
    sys.stderr.write("Install: pip3 install --user youtube-transcript-api\n")
    sys.exit(2)


def main() -> int:
    if len(sys.argv) < 2:
        sys.stderr.write("usage: fetch-transcript.py <video_id> [lang]\n")
        return 2
    vid = sys.argv[1]
    lang = sys.argv[2] if len(sys.argv) > 2 else "ko"
    try:
        result = YouTubeTranscriptApi().fetch(vid, languages=[lang])
        text = " ".join(s.text for s in result.snippets)
    except Exception as e:  # noqa: BLE001 — surface every failure mode
        sys.stderr.write(f"{type(e).__name__}: {e}\n")
        return 1
    if len(text) < 200:
        sys.stderr.write(f"transcript too short: {len(text)} chars\n")
        return 1
    print(text[:30000])
    return 0


if __name__ == "__main__":
    sys.exit(main())
