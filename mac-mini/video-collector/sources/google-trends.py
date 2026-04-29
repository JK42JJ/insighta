#!/usr/bin/env python3
"""
Source 2b (Google Trends fallback) — pytrends helper.

Spawned by the TS orchestrator when Naver DataLab returns insufficient
keywords. Outputs a newline-separated list of trending search terms to
stdout (one term per line). Empty stdout = no terms available.

Run from Mac Mini's video-dictionary uv environment so pytrends is
already on PYTHONPATH:

    uv run --with pytrends python google-trends.py KR US

Args: ISO country codes to pull daily trends for.
"""

import sys
from typing import List

try:
    from pytrends.request import TrendReq
except ImportError:
    sys.stderr.write("pytrends not installed. Run via 'uv run --with pytrends'.\n")
    sys.exit(2)


def collect_daily_trends(country_codes: List[str]) -> List[str]:
    out: List[str] = []
    pytrends = TrendReq(hl="ko", tz=540, timeout=(10, 25))
    for cc in country_codes:
        try:
            df = pytrends.trending_searches(pn=country_to_pn(cc))
        except Exception as exc:  # noqa: BLE001 — best-effort scrape
            sys.stderr.write(f"trending_searches({cc}) failed: {exc}\n")
            continue
        if df is None or df.empty:
            continue
        for term in df.iloc[:, 0].tolist():
            if isinstance(term, str) and term.strip():
                out.append(term.strip())
    seen = set()
    deduped = []
    for term in out:
        if term in seen:
            continue
        seen.add(term)
        deduped.append(term)
    return deduped


def country_to_pn(code: str) -> str:
    """Map ISO country code to pytrends `pn` slug."""
    mapping = {
        "KR": "south_korea",
        "US": "united_states",
        "JP": "japan",
        "GB": "united_kingdom",
    }
    return mapping.get(code.upper(), code.lower())


def main() -> int:
    countries = sys.argv[1:] if len(sys.argv) > 1 else ["KR", "US"]
    terms = collect_daily_trends(countries)
    for t in terms:
        print(t)
    return 0


if __name__ == "__main__":
    sys.exit(main())
