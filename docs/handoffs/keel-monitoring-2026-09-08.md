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
2026-07-22. The cause is not the network and not the Mac Mini service:

- `pipeline_events` is written by exactly one place in the codebase —
  the handler for `POST /api/v1/internal/transcript/summarize`.
- That route is called by the collector on the Mac Mini, which polls
  `/candidates` and posts results back. The traffic runs Mac Mini → cluster,
  not cluster → Mac Mini.
- Measured over ssh: the transcript *service* has been up 81 days and answers
  with the cluster's token. The *collector* is not running, and there is no
  launchd entry for it, so nothing restarts it after a reboot.

So the collector stopped, and nothing said so for forty-seven days. Restarting
it and registering it with launchd is the open item.

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
- **The PWA service worker intercepts `/keel`.** It is in
  `navigateFallbackDenylist`; anything else added under the origin needs the
  same treatment.

## Open

1. Restart the Mac Mini collector and register it with launchd.
2. Set `SLACK_ALERT_WEBHOOK`, or alerts stay in the ledger.
3. `SNAPSHOT_SERVICE_URL` has no alternative — decide whether it gets one.
