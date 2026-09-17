# Keel — monitoring platform, and what it found

2026-09-08. Written at the end of the session that built it.

## What Keel is

A monitoring platform that runs without anyone starting it. Three parts:

| part | where it runs | what it does |
|---|---|---|
| checks | GitHub Actions, `keel.yml`, every 30 min | 8 invariant checks; writes every result to `error_events` (`subsystem='keel'`) |
| metrics | in-cluster | VictoriaMetrics + node-exporter + kube-state-metrics + the app's own `/metrics` |
| dashboards | in-cluster Grafana at `/keel/` | invariants (24 panels) and resources (12 panels) |

Grafana provisions itself. A PreSync hook (`charts/insighta/files/keel-provision.js`)
generates the read-only DB role password, verifies it by connecting, creates the
RLS policies, generates the basic-auth credential, and restarts Grafana when
anything rotates. Nobody types a password and nobody knows one.

Two ways in:

    scripts/ops/keel-url.sh          the public URL with its credential
    scripts/ops/grafana-ui.sh 3001   ssh + port-forward, no ingress auth

## The eight checks

`deploy-drift` · `public-surface` · `transcript-proxies` · `service-reachability`
· `llm-spend` · `aws-cost` · `pipeline-freshness` · `db-schema`

Alerts are edge-triggered: a check that fails twice alerts once. Both edges are
written to the ledger, so "when did it recover" is answerable.
`SLACK_ALERT_WEBHOOK` is not set, so alerts currently reach the ledger and the
run log only.

## What it found on the first day

Three checks fail, and all three are real.

**Transcript ingestion is down (47 days).** `pipeline_events` last took a row on
2026-07-22. Two independent blockers, both measured on 2026-09-08.

*The write path, so the direction is not misread:* `pipeline_events` is written
by exactly one place in the codebase — the handler for
`POST /api/v1/internal/transcript/summarize`. That route is called by the
authoring batch on the Mac Mini (`mac-mini/v2-author/`), which polls
`/candidates` and posts results back. The traffic runs **Mac Mini → cluster**.

**Blocker 1 — the batch is pointed at a Webshare account whose bandwidth is
spent.** The subscription is annual and current; what runs out is transfer. Two
credential sources exist on the machine and only one is maintained:

| used by | source | result |
|---|---|---|
| transcript service (`:4242`) | `~/.transcript-svc.env`, username `<base>-rotate` | works — returns real YouTube responses |
| v2-author batch | `com.insighta.daily-targeted.plist` `EnvironmentVariables` | `402 Payment Required` |

Three probes, same video, seconds apart, separate the cases: the plist username
returns **402** (authenticated, no transfer left), a bare `<base>` returns
**407** (wrong username form), and `<base>-rotate` returns **rc=0 with a VTT
written**. 402 and 407 are different answers and only the second is an auth
problem — reading 402 as "the subscription lapsed" is wrong.

The split dates to 2026-05-06 (CP439): the credentials then in
`video-dictionary/.env` were out of quota, the `.env` immutability rule barred
editing that file, so a second account was injected into the plist as the
override. The plist has not been touched since; `.transcript-svc.env` has.

Fix, per the same record: `PlistBuddy -c "Set :EnvironmentVariables:<KEY> <v>"`
on the plist, then `launchctl unload` + `load`. It is configuration, not code —
the canonical override location is the plist, and adding a third source would
make the next person's search longer, not shorter.

**Blocker 2 — the launchd job is not loaded, and cannot be loaded over ssh.**
`~/Library/LaunchAgents/com.insighta.daily-targeted.plist` exists and is correct
(hourly 00:00–06:00, `TRANSCRIPT_FETCHER=ytdlp`, Webshare credentials, N=70).
It is absent from `launchctl list`, and it cannot be registered remotely:

    launchctl bootstrap gui/501 ...   Bootstrap failed: 125: Domain does not support specified action
    launchctl bootstrap user/501 ...  Bootstrap failed: 5: Input/output error
    launchctl managername             Background

Error 125 on `gui/501` means no Aqua session exists — the machine sits at the
login window (`stat -f %Su /dev/console` returns `root`). A LaunchAgent needs
that session, and so does `claude -p`, which the batch shells out to. Loading it
requires a GUI login on the machine, or root.

The machine has **not** rebooted: uptime is 81 days, which matches the transcript
service's own 81 days. Whatever ended the GUI session ended the scheduled jobs
with it; long-running processes started earlier survived.

**The defect that hid it, now fixed.** `process-one.sh` mapped every failed
fetch — including a proxy that refuses — to `no_caption`, stamped
`transcript_attempted_at` (dropping the video from the pool for seven days),
and exited 0. Hourly, that read as "none of today's videos have subtitles" while
consuming the backlog. It now reports `proxy_error` with the reason, does not
stamp the video, and `batch.sh` exits 5 when every fetch was blocked at the
proxy. Verified: one run reports
`proxy_error=1 ... every fetch was blocked at the proxy (1)` and `rc=5`.

These scripts are untracked on purpose (#771, public-repo cleanup) and live only
on the Mac Mini at `~/code/insighta/mac-mini/v2-author/`. Backups from this
change: `process-one.sh.bak-20260908-191834`, `batch.sh.bak-20260908-191834`.

**Note figure enrichment is down.** `SNAPSHOT_SERVICE_URL` times out from a pod
and has no alternative, so figures are not enriched.

**Mandala embedding is degraded, not down.** `MANDALA_GEN_URL` times out, and
`MANDALA_EMBED_RACE` runs OpenRouter alongside it, so the feature works.

## Diagnoses that were wrong, and why

Recorded because the failure mode repeated three times in one session and the
correction cost more than the checks did.

| claimed | actual | what the claim rested on |
|---|---|---|
| mandala generation stopped at cutover | never stopped — prod runs OpenRouter | the code default, not the prod env |
| the Azure proxy's token is wrong | token is fine; a 401 came from calling without one | one probe, no token |
| the cluster cannot reach the Mac Mini, so ingestion stopped | true and not the cause — the traffic runs the other way | the shape of the config, not the call graph |

Each was stated from code or config rather than from production. The rule that
would have caught all three: measure the running system before naming a cause.

## Sharp edges

- **ArgoCD does not compare hook manifests.** A commit that changes only
  `keel-provision.js` leaves the app `Synced` and the hook never runs. The
  Grafana Deployment carries `checksum/provision` to force it.
- **Pin PRs get no CI.** They touch only `charts/`, so path filters skip every
  job and the PR sits `BLOCKED` forever. They are merged with `--admin`.
- **A 500 from a transcript proxy is a healthy answer.** It forwards YouTube's
  own refusal. Only 401 and a transport error mean the proxy is unusable.
- **RLS, not GRANT.** `GRANT SELECT` alone returns zero rows with no error.
  Every table Grafana reads needs a policy.
- **yt-dlp through Webshare has a documented bot gate.** Sustained use draws
  "Sign in to confirm you're not a bot". The remedy is already written down —
  exclude the slot via `WEBSHARE_EXCLUDED_SLOTS`, keep a session under twenty
  yt-dlp calls, do not retry a gated slot — so this is a lookup, not a new
  problem to solve.
- **The PWA service worker intercepts `/keel`.** It is in
  `navigateFallbackDenylist`; anything else added under the origin needs the
  same treatment.

## Open

1. Point the plist at the credentials `.transcript-svc.env` already uses
   (PlistBuddy, then `launchctl unload`/`load`). The subscription is fine; the
   account the plist names has no transfer left.
2. Log into the Mac Mini's GUI (or run `launchctl bootstrap gui/501` as root) so
   `com.insighta.daily-targeted` loads. Both are needed; either alone leaves the
   pipeline stopped.
3. Set `SLACK_ALERT_WEBHOOK`, or alerts stay in the ledger.
4. `SNAPSHOT_SERVICE_URL` has no alternative — decide whether it gets one.
