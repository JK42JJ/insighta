# ROADMAP — Track-State Ledger (SSOT)

> Why this file exists: in the CP509 autonomous-loop session (2026-07-02), TWO
> supervisor directives were issued on stale premises — "enrich forceRegen leak"
> (already plugged by #961) and "M1 = decommission mandala_relevance_pct"
> (explicitly REFUTED in CP499). Final verdicts were scattered across handoffs,
> schema comments, and session memory with no single index. This ledger is that
> index. §2 (refuted decisions) is the load-bearing part: it breaks the
> "re-instruct the same refuted thing" loop.
>
> State enum — `ACTIVE` (work in progress) / `GATED-on-James` (done, awaiting a
> James decision or merge) / `CLOSED` (verdict final, no residual work) /
> `REFUTED` (investigated and rejected — do not re-attempt, see §2) /
> `DEFERRED` (parked with an explicit revisit condition).

## §1 Track-state ledger (only tracks with an actual verdict — no speculative rows)

| Track | State | Last verdict | Normative pointer |
|---|---|---|---|
| 26년금융 direct-collect (search quality) | GATED-on-James | CP509+1: cell-median 58.5→72, 0 regression — screen verification pending | docs/handoffs/insighta-session-handoff-2026-07-02-cp508-search-quality.md |
| cosine-recruit serving lever | GATED-on-James | CP509 #1051 merged flag-OFF; ROI material packaged (c1/c3/c6 gap) | src/config/pool-serve.ts:51 |
| G5 key consolidation (8→1) | GATED-on-James | CP509+1: step1 alert PR #1056 (CI green); step3 secrets-shrink after merge | PR #1056 |
| G4 serving-quality policy set | DEFERRED | CP509+1: 7-item scoping complete, all policy changes frozen pending decisions | PR #1056–#1068 session records |
| M1 relevance SSOT | CLOSED (column KEEP) | CP499 #875/#876: per-user relevance lives in uvs/ulc; global column kept as v2-complete signal | docs/handoffs/relevance-idempotent-ssot-cp499.md:41 |
| M3 pool serving reactivation | GATED-on-James | CP509+1: v5 relevance gate implemented fail-closed; remaining = V5_POOL_SERVE canary flag decision | docs/handoffs/v5-relevance-gate-cp497.md:132 |
| Non-smoke test debt | CLOSED (23→0 suites) | CP509+1: 7 test-only PRs (#1058–#1065), zero code regressions found | PR #1058 #1060 #1061 #1062 #1063 #1064 #1065 |
| v2 cost bundle (attribution + pricing) | GATED-on-James | CP509+1: #963 instrumentation (PR #1066) + last pricing gap (PR #1068); leak already plugged | PR #1066, PR #1068 |
| Mac Mini collector published_at stamping (external repo) | ACTIVE (follow-up) | CP509+1: bulk payload stamped collection-time published_at on 781 youtube_videos rows (2026-04-25 cluster); in-repo now-fallback removed in PR #1070 — the external collector must stop sending fabricated publish dates or new ingests keep re-contaminating | PR #1070 (in-repo half) |
| v1 executor skills-route exposure | GATED-on-James | CP509+1: only live edge = POST /api/v1/skills/:skillId/execute, no version guard; close-vs-keep decision pending | src/api/routes/skills.ts:152 |
| Diversity re-injection / exclude-set saturation | DEFERRED (out of D-04 scope) | 2026-07-03: exclude_set 7.7K (whole uvs) starves live-search candidates into the tail — secondary cause of the floor-incident perception; explicitly excluded from the quality-gate surgery to prevent scope erosion | scratchpad d04-gate-design.md §1-⑤ · add_cards.end trace exclude_set_size |

## §2 Refuted-decisions registry (DO NOT re-attempt without overturning the cited verdict)

| Refuted idea | Why (verdict) | Normative pointer |
|---|---|---|
| Decommission `video_rich_summaries.mandala_relevance_pct` | Load-bearing v2-quick-COMPLETE signal (BE SSE has_quick + FE pending dot); stopping the write stalls the dashboard spinner forever | docs/handoffs/relevance-idempotent-ssot-cp499.md:41 · prisma/schema.prisma:2419 (#876 KEEP) |
| centerGoal anchor restoration in pool recruit queries | CP492 §27/§82: the original disease was center EXCESS (9-word concat → unsearchable), not absence; the fix is LLM-melted short queries | docs/handoffs/v5-relevance-gate-cp497.md:28 |
| Ungated pool serving (batch_trend or any source without a relevance judge) | "Unjudged pool serving IS the incident definition. No gate → no pool" (CP494+1 quality-destruction incident) | docs/handoffs/v5-relevance-gate-cp497.md:68 |
| Re-fixing the enrich forceRegen "leak" | Core path already short-circuits complete v2 rows since #961; residual exposure is the intended upgrade path (pass-but-not-complete rows) | src/modules/queue/handlers/enrich-rich-summary.ts:123 (#961 guard) |
| Standalone view-count floor gate (V5_LIVE_VIEW_FLOOR alone) | 2026-07-03 canary: user-verified relevance regression — 84% of a niche mandala's relevant candidates sat under 1000 views (incl. official Microsoft/AWS lectures); floor rolled back same morning. Trust axis may only return COMBINED with relevance (gate-form), never alone | PR #1076 (arm) → PR #1080 (rollback) · trace: raw 305→13 vs floor-off 60 |

## §3 Maintenance contract

- A row changes ONLY when a verdict lands (ship / close / refute / gate) — one-line
  diff in the same PR or session that produced the verdict.
- A §2 entry requires a merged normative pointer (file:line). No pointer, no entry —
  an unsourced refutation is itself new staleness.
- Wiring candidates (NOT wired by this doc-only PR; separate decisions):
  `/save` step appending verdict rows; `/init` loading this file in Phase 0.
