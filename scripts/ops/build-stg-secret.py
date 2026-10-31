#!/usr/bin/env python3
"""Builds the staging env Secret (namespace insighta-staging, name insighta-env)
from prod's, and reports how staging differs from prod.

Runs on the k3s node, where `sudo k3s kubectl` reads both Secrets. Use the
wrapper scripts/ops/apply-stg-secret.sh, which ships this file there and feeds
it the staging database settings from ~/.insighta/stg-supabase.env.

  build-stg-secret.py --diff    print the difference list, change nothing
  build-stg-secret.py --apply   write the Secret; prints "changed: <n>"

Why a script and not a one-off: the first staging Secret was built by hand in a
scratch file, then patched twice, and the reasoning lived only in a chat. Every
rule below has a cost or a safety reason; keep the reason next to the rule.

The rules, in the order they are applied:
  1. OMIT   keys that cost money per use, reach customers, or belong to prod only.
  2. FORCE  flags set to a fixed value on staging.
  3. YOUTUBE  one search key, not all of them (see YOUTUBE_SOURCE).
  4. GENERATED  secrets staging owns. Kept when the staging Secret already has
     them: rotating ENCRYPTION_SECRET breaks what staging already encrypted and
     rotating a Redis password needs a Redis restart.
  5. OVERRIDES  the staging database and Supabase project, from stdin.
Refuses to write a Secret in which any value names the prod Supabase project.
"""
import argparse
import base64
import json
import secrets
import subprocess
import sys

NAMESPACE_STG, NAMESPACE_PROD, SECRET = "insighta-staging", "insighta-prod", "insighta-env"

# This repository is public and already names the prod project (deploy.yml).
PROD_PROJECT_REF = "rckkhhjanqgaopynhfgd"
STG_ORIGIN = "https://stg.insighta.one"

# 1. Never copied. Pay-per-use APIs: R01 forbids LLM calls outside the service,
# and James ruled out extra cost (2026-10-29). Customer-facing or prod-only
# resources: payments, alerts, the prod bot user, the prod Tailscale address.
OMIT_EXACT = {
    "OPENROUTER_API_KEY", "GEMINI_API_KEY", "COHERE_API_KEY", "ELEVENLABS_API_KEY",
    "RUNPOD_API_KEY", "QWEN_LORA_API_URL", "MANDALA_GEN_URL",
    "AZURE_TRANSCRIPT_URL", "MAC_MINI_TRANSCRIPT_URL", "MAC_MINI_TRANSCRIPT_TOKEN",
    "SNAPSHOT_SERVICE_URL", "SNAPSHOT_SERVICE_TOKEN",
    "NAVER_CLIENT_ID", "NAVER_CLIENT_SECRET",
    "SLACK_ALERT_WEBHOOK", "OBSERVABILITY_ALERT_EMAIL",
    "INSIGHTA_TAILSCALE_IP", "INSIGHTA_BOT_USER_ID", "SUPABASE_JWT_SECRET", "GIT_SHA",
}
OMIT_PREFIX = ("LEMONSQUEEZY_", "YOUTUBE_")  # YOUTUBE_*: one key comes back in step 3

# 2. Fixed on staging. Mail is James's authority (R02); the scheduled jobs would
# spend on APIs staging has no keys for. Names only here; values are "false".
FORCE_FALSE = [
    "TRANSACTIONAL_EMAIL_ENABLED", "RICH_SUMMARY_V2_CRON_ENABLED", "CURATION_SCHED_KST_ENABLED",
    "V2_AUTO_ENRICH_ENABLED", "V2_QUALITY_AUDIT_ENABLED", "V2_QUALITY_REGEN_ENABLED",
    "YOUTUBE_METADATA_BACKFILL_ENABLED", "NARRATION_PREPRODUCE_ENABLED",
    "BOOK_ENRICH_ENABLED", "CONFIG_CHANGE_EVENTS_ENABLED",
]
FORCE_VALUE = {
    # prod: llm. The rule-based query generator needs no paid API.
    "V5_QUERY_GEN": "rule",
    # prod: shadow, an async Haiku scorer that has no key on staging.
    "LIVE_SEARCH_GC_GATE": "off",
}

# 3. Card collection searches YouTube (free quota, shared with prod's keys).
# One key bounds how much of prod's daily quota staging can draw: 1 of 8.
YOUTUBE_SOURCE, YOUTUBE_TARGET = "YOUTUBE_API_KEY_SEARCH_8", "YOUTUBE_API_KEY_SEARCH"

# 4. Staging's own secrets.
GENERATED = {
    "ENCRYPTION_SECRET": lambda: secrets.token_hex(48),  # config requires >= 64 chars
    "INTERNAL_BATCH_TOKEN": lambda: secrets.token_urlsafe(32),
    "REDIS_ADMIN_PASSWORD": lambda: secrets.token_urlsafe(24),
    "REDIS_COLLECTOR_PASSWORD": lambda: secrets.token_urlsafe(24),
    "REDIS_INSIGHTA_PASSWORD": lambda: secrets.token_urlsafe(24),
    "REDIS_INSIGHTA_UPSERT_PASSWORD": lambda: secrets.token_urlsafe(24),
}

# 5. Supplied by the caller from the staging Supabase project.
OVERRIDES_REQUIRED = [
    "DATABASE_URL", "DIRECT_URL", "SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY",
]


def omitted(key):
    return key in OMIT_EXACT or key.startswith(OMIT_PREFIX)


def build(prod, stg, overrides):
    """prod, stg: decoded key->value dicts. Returns (secret, origin) where origin
    maps each key to how it got its value."""
    out, origin = {}, {}
    for k, v in prod.items():
        if omitted(k):
            continue
        out[k], origin[k] = v, "same"
    for k in FORCE_FALSE:
        if k in prod:
            out[k], origin[k] = "false", "forced"
    for k, v in FORCE_VALUE.items():
        out[k], origin[k] = v, "forced"
    if YOUTUBE_SOURCE not in prod:
        raise SystemExit(f"prod has no {YOUTUBE_SOURCE}")
    out[YOUTUBE_TARGET], origin[YOUTUBE_TARGET] = prod[YOUTUBE_SOURCE], "one prod key"
    for k, make in GENERATED.items():
        out[k], origin[k] = stg.get(k) or make(), "generated"
    missing = [k for k in OVERRIDES_REQUIRED if not overrides.get(k)]
    if missing:
        raise SystemExit("missing overrides: " + ", ".join(missing))
    for k in OVERRIDES_REQUIRED:
        out[k], origin[k] = overrides[k], "staging project"
    out["CORS_ORIGIN"], origin["CORS_ORIGIN"] = STG_ORIGIN, "staging project"
    leaks = sorted(k for k, v in out.items() if PROD_PROJECT_REF in v)
    if leaks:
        raise SystemExit("refusing: values name the prod project in " + ", ".join(leaks))
    return out, origin


def report(prod, out, origin):
    omit = sorted(k for k in prod if omitted(k))
    lines = [f"prod keys {len(prod)} | staging keys {len(out)} | omitted {len(omit)}", ""]
    lines.append("omitted (not on staging): " + " ".join(omit))
    lines.append("")
    lines.append("forced flags (prod -> staging):")
    for k in sorted(k for k, o in origin.items() if o == "forced"):
        lines.append(f"  {k}: {prod.get(k, '(unset)')} -> {out[k]}")
    lines.append("")
    for label in ("one prod key", "generated", "staging project"):
        names = sorted(k for k, o in origin.items() if o == label)
        lines.append(f"{label}: " + " ".join(names))
    same = sum(1 for o in origin.values() if o == "same")
    lines.append("")
    lines.append(f"same value as prod: {same} keys")
    return "\n".join(lines)


def kget(ns):
    try:
        raw = subprocess.check_output(["sudo", "k3s", "kubectl", "-n", ns, "get", "secret", SECRET, "-o", "json"])
    except subprocess.CalledProcessError:
        return {}
    return {k: base64.b64decode(v).decode() for k, v in json.loads(raw)["data"].items()}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--diff", action="store_true")
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--prod-json", help="read prod from a file (tests)")
    ap.add_argument("--stg-json", help="read staging from a file (tests)")
    ap.add_argument("--emit", help="write the built Secret as JSON to this path (tests)")
    a = ap.parse_args()
    prod = json.load(open(a.prod_json)) if a.prod_json else kget(NAMESPACE_PROD)
    stg = json.load(open(a.stg_json)) if a.stg_json else kget(NAMESPACE_STG)
    overrides = json.loads(sys.stdin.read() or "{}")
    out, origin = build(prod, stg, overrides)
    if a.emit:
        json.dump(out, open(a.emit, "w"))
        return
    changed = sorted(k for k in set(out) | set(stg) if out.get(k) != stg.get(k))
    if a.diff or not a.apply:
        print(report(prod, out, origin))
        print(f"\nwould change on staging: {len(changed)} keys {changed}")
        return
    manifest = {"apiVersion": "v1", "kind": "Secret", "type": "Opaque",
                "metadata": {"name": SECRET, "namespace": NAMESPACE_STG},
                "data": {k: base64.b64encode(v.encode()).decode() for k, v in out.items()}}
    subprocess.run(["sudo", "k3s", "kubectl", "apply", "-f", "-"], input=json.dumps(manifest).encode(),
                   check=True, stdout=subprocess.DEVNULL)
    print(f"changed: {len(changed)} {changed}")


if __name__ == "__main__":
    main()
