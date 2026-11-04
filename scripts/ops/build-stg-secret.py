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

The principle (James, 2026-10-29: "set it the same as prod"): staging copies
prod's env Secret. It differs in exactly three kinds of places, each because
the effect would leave the cluster or run without anyone watching:
  - OMIT    a message to people outside the test (Slack and e-mail alerts), a
            real payment (LemonSqueezy), and ids that name prod rows.
  - FORCE   flags set to false: e-mail, and the scheduled jobs that would spend
            API budget or YouTube quota unattended.
  - ORIGIN  the public address: share links, OAuth callback, CORS.
Everything else is the same as prod, the YouTube keys included. The OpenRouter
key is staging's own (James, 2026-11-04): staging runs relevance scoring and
summaries, and its spend must not draw on prod's key. Sign-ups on the staging Supabase project stay closed, because those
keys are now reachable from staging.

The rules, in the order they are applied:
  1. OMIT   keys that must not exist on staging.
  2. FORCE  flags fixed to "false".
  3. ORIGIN keys fixed to the staging address.
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

# 1. Never copied.
OMIT_EXACT = {
    "SLACK_ALERT_WEBHOOK", "OBSERVABILITY_ALERT_EMAIL",  # staging alerts would land in prod's channel
    "INSIGHTA_BOT_USER_ID",                              # names a prod user
    "SUPABASE_JWT_SECRET", "GIT_SHA",                    # staging has its own
}
OMIT_PREFIX = ("LEMONSQUEEZY_",)  # prod keys charge real cards

# 2. Fixed to "false". Mail is James's authority (R02). The others run on a
# schedule with nobody watching and would spend API budget or YouTube quota:
# the first staging pipeline run had already drawn on prod's quota.
FORCE_FALSE = [
    "TRANSACTIONAL_EMAIL_ENABLED", "CURATION_SCHED_KST_ENABLED", "RICH_SUMMARY_V2_CRON_ENABLED",
    "V2_QUALITY_AUDIT_ENABLED", "V2_QUALITY_REGEN_ENABLED", "YOUTUBE_METADATA_BACKFILL_ENABLED",
    "NARRATION_PREPRODUCE_ENABLED",
    # Summaries on staging are made when a user opens a card (James, 2026-11-04), not
    # for every card a new mandala gets: this stops the creation-time enrich-video
    # chain and the note build that follows it. The click path is not gated by it.
    "V2_AUTO_ENRICH_ENABLED",
]

# 3. The public address. PUBLIC_ORIGIN is not in prod's Secret at all: the code
# defaults it to https://insighta.one, so share links on staging would point at prod.
ORIGIN_VALUES = {
    "PUBLIC_ORIGIN": STG_ORIGIN,
    "CORS_ORIGIN": STG_ORIGIN,
    "YOUTUBE_REDIRECT_URI": STG_ORIGIN + "/oauth/callback",
}

# 3b. Values staging sets on purpose, apart from prod: the way to try a different
# model or setting on staging without touching prod's Secret. Empty means staging
# runs what prod runs. Remove an entry (and re-apply) to go back to prod's value.
# RICH_SUMMARY_V2_REASONING_EFFORT: deepseek-v4-flash spends all 8192 output tokens on
# reasoning for some videos and returns no body (read from the response, 2026-11-05);
# staging tries a lower reasoning effort (James, 2026-11-05).
FIXED_VALUES = {
    "RICH_SUMMARY_V2_REASONING_EFFORT": "low",
}

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
    "OPENROUTER_API_KEY",
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
    for k, v in ORIGIN_VALUES.items():
        out[k], origin[k] = v, "staging address"
    for k, v in FIXED_VALUES.items():
        out[k], origin[k] = v, "staging value"
    for k, make in GENERATED.items():
        out[k], origin[k] = stg.get(k) or make(), "generated"
    missing = [k for k in OVERRIDES_REQUIRED if not overrides.get(k)]
    if missing:
        raise SystemExit("missing overrides: " + ", ".join(missing))
    if overrides["OPENROUTER_API_KEY"] == prod.get("OPENROUTER_API_KEY"):
        raise SystemExit("refusing: the staging OPENROUTER_API_KEY is the same as prod's")
    for k in OVERRIDES_REQUIRED:
        out[k], origin[k] = overrides[k], "staging project"
    leaks = sorted(k for k, v in out.items() if PROD_PROJECT_REF in v)
    if leaks:
        raise SystemExit("refusing: values name the prod project in " + ", ".join(leaks))
    return out, origin


def report(prod, out, origin):
    omit = sorted(k for k in prod if omitted(k))
    lines = [f"prod keys {len(prod)} | staging keys {len(out)} | omitted {len(omit)}", ""]
    lines.append("omitted (not on staging): " + " ".join(omit))
    lines.append("")
    lines.append("flags forced to false (prod -> staging):")
    for k in sorted(k for k, o in origin.items() if o == "forced"):
        lines.append(f"  {k}: {prod.get(k, '(unset)')} -> {out[k]}")
    lines.append("")
    for label in ("staging address", "staging value", "generated", "staging project"):
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
