# Job Queue Design — #299 Batch Enrichment Concurrency Isolation

> Status: DRAFT | Author: Claude Code | Date: 2026-03-27

## Problem Statement

Current enrichment pipeline has two competing paths (ClawbotScheduler + EnrichmentScheduler) that:
1. Compete for the same unsummarized video pool without coordination
2. Store job history in-memory only (lost on restart)
3. Have no real queue — just timers + child process fork
4. Cannot prioritize user-triggered enrichment over background batch

## Current Architecture

```
API Server (main process)
  ├── ClawbotScheduler (cron */30)
  │   └── fork() → enrich-worker.js → systemBatchEnrich()
  ├── EnrichmentScheduler (30min cycle)
  │   └── enrichVideo() in-process (health-adaptive)
  └── POST /admin/enrichment/batch (manual trigger)
      └── fork() → enrich-worker.js
```

**Pain points**: dual path duplication, in-memory state, no mutex, no priority.

## Option Analysis

| Option | Pros | Cons | Infra Cost |
|--------|------|------|------------|
| **pg-boss** (Postgres-backed) | Uses existing Supabase DB, persistent, battle-tested | Polling overhead, adds dependency | $0 |
| **BullMQ** (Redis-backed) | Fast, rich features (rate limiting, priorities) | Requires Redis server | ~$15/mo |
| **Custom in-process queue** | Zero dependencies, simple | Not persistent, single-process only | $0 |
| **Temporal** (workflow engine) | Enterprise-grade, durable | Heavy, $25/mo+ (M11 scope) | $25/mo+ |

## Recommendation: pg-boss

**Rationale**: Insighta runs on a single EC2 t3.medium instance. pg-boss uses the existing Supabase Postgres as its backing store — zero additional infra cost.

**Key pg-boss features matching our requirements**:
- Job persistence across restarts (Postgres-backed)
- Concurrency control (configurable worker count)
- Retry with exponential backoff
- Job priority (user-triggered > background)
- Scheduled jobs (replaces cron)
- Job completion/failure tracking
- Automatic expired job cleanup

## Target Architecture

```
API Server
  ├── pg-boss instance (connects to existing Postgres)
  │   ├── Queue: "enrich-video" (concurrency: 1)
  │   │   └── Worker: enrichVideo(videoId)
  │   ├── Queue: "batch-scan" (scheduled, every 30 min)
  │   │   └── Worker: scan unsummarized → enqueue individual jobs
  │   └── Queue: "user-enrich" (priority: high)
  │       └── Worker: enrichVideo(videoId) — same handler, higher priority
  └── Admin API
      ├── POST /admin/enrichment/batch → enqueue batch-scan
      ├── GET /admin/enrichment/jobs → pg-boss job history
      └── POST /api/v1/cards/:id/enrich → enqueue user-enrich (high priority)
```

## Implementation Phases

### Phase 1: pg-boss Foundation (this story)
- Install pg-boss, initialize with existing DATABASE_URL
- Create `enrich-video` queue with concurrency: 1
- Migrate EnrichmentScheduler → pg-boss scheduled job
- Remove ClawbotScheduler (consolidate to single path)
- Estimated: 8-12 files, 1-2 sessions

### Phase 2: Priority & User-Triggered (follow-up story)
- Add `user-enrich` queue with higher priority
- Add card-level "Enrich" button in UI
- Progress tracking via pg-boss job states

### Phase 3: Extensibility (future)
- Sync jobs, report generation via same queue
- Dashboard integration for job monitoring

## Database Impact

pg-boss creates its own schema (`pgboss`) with tables:
- `pgboss.job` — job queue
- `pgboss.schedule` — recurring schedules
- `pgboss.version` — migration tracking

No impact on existing `public` schema. Uses same Postgres connection.

## Migration Path

1. Add pg-boss dependency
2. Create `src/modules/queue/` module
3. Create queue manager (init, publish, subscribe)
4. Create `enrich-video` worker (reuse existing `enrichVideo()`)
5. Create `batch-scan` scheduled job (reuse scan logic from EnrichmentScheduler)
6. Wire into server.ts startup/shutdown
7. Remove ClawbotScheduler + EnrichmentScheduler
8. Update admin API routes
9. Add tests

## Rollback Plan

pg-boss tables are isolated in `pgboss` schema. If issues arise:
1. Stop pg-boss workers
2. Re-enable ClawbotScheduler/EnrichmentScheduler
3. Drop `pgboss` schema

## Dependencies

- `pg-boss` npm package (~50KB)
- Existing Postgres connection (DATABASE_URL)
- No new infrastructure required

## Open Questions

1. Should we keep EnrichmentScheduler's adaptive health monitoring in the pg-boss worker?
2. Circuit breaker: implement as pg-boss retry policy or custom logic?
3. Prod DB: need `CREATE SCHEMA` permission for pg-boss init — verify with Supabase Cloud.

## References

- Issue: #299
- Current enrichment: `src/modules/ontology/enrichment.ts`
- ClawbotScheduler: `src/modules/scheduler/clawbot.ts`
- EnrichmentScheduler: `src/modules/enrichment/scheduler.ts`
- Troubleshooting: Clawbot infinite failure loop (LEVEL-2, recurrence: 1)
