# Phase 1 Slice 2+4 — SSE streaming card delivery

> **Status**: design draft 2026-04-21. Pending approval.
> **Scope**: Backend SSE endpoint (slice 2) + Frontend EventSource
> consumer with append-style render (slice 4).
> **Goal**: Reduce first-card-visible time from current ~120s
> (skeleton observed in the SGNL-parity screenshots) to **< 2s**.
> **Budget**: slice 2 ~6-8h / slice 4 ~6-8h = ~2 dev-days total.

## 1. Context

Slice 1 (`2ba3e64`) capped individual YouTube `search.list` calls at
1000ms and switched the fan-out to `Promise.allSettled`, eliminating
tail-latency bottlenecks. Slice 3 (PR #429) collapsed the mandala
two-LLM-call sequence (structure + labels) into one by fixing the
`STRUCTURE_MAX_TOKENS` truncation that was silently dropping labels.

Both are **within-request latency reductions**. The user-visible wall
clock still pays:
  1. Mandala structure+labels call (~1-3s on Haiku)
  2. Keyword generation (LLM race, ~500-1500ms)
  3. YouTube search fan-out (capped at 1s by slice 1, but still full
     fan-out completion required before any cards render)
  4. Rerank + persist to `recommendation_cache`
  5. Frontend polls `/recommendations` → cards appear as a batch

Slice 2+4 breaks step 5: cards surface to the UI **as they arrive
from YouTube**, not after the pipeline finishes. First card visible
≈ step 1 + first fastest YouTube response ≈ ~1.5-2s total.

## 2. Three approaches considered

### 2.A. Pure SSE — executor directly streams

SSE endpoint invokes v3 executor inline and pushes each search-result
batch to the client as the search completes. Client consumes
`EventSource` and appends cards.

* **Latency**: first card = 1 × LLM + 1 × fastest YouTube call (~1.5-2s).
* **Drawback**: bypasses the existing `recommendation_cache` read
  contract. Subsequent page loads either miss the cards (not
  persisted until later) or need a second persist path.

### 2.B. Polling of existing `/recommendations`

Frontend polls the existing read-only endpoint at 1-2s intervals.
No backend change except ensuring the v3 executor upserts
incrementally (it already does per-call).

* **Latency**: first card ≈ `poll_interval / 2` + pipeline wall
  clock ≈ ~10-30s in practice.
* **Drawback**: polling waste; still bounded by the pipeline
  completion timing (executor upserts are batched today).

### 2.C. Hybrid — SSE wrapper over persist-then-notify

V3 executor upserts each card as it arrives (step 4 broken into
per-call upserts). An event bus (PostgreSQL `LISTEN / NOTIFY` or
Redis pub/sub) notifies the SSE endpoint for that mandala. SSE
forwards the notification; client appends.

* **Latency**: first card = 1 × LLM + 1 × fastest YouTube + upsert
  (~10-50ms) + notify dispatch (~10ms) ≈ ~1.5-2s.
* **Drawback**: requires pub/sub infrastructure; two new moving
  parts (notify channel + SSE client bridge).
* **Benefit**: persistence-first, so reloads / cross-device sync
  still work; SSE is purely a "speedup" layer.

## 3. Recommendation

**2.C (Hybrid)** with staged delivery:

1. Ship the **SSE endpoint as a thin forwarder** over a minimal
   pub/sub primitive (`PostgreSQL LISTEN/NOTIFY` — no new infra; the
   DB is already in the path). Frontend treats it as "bonus speedup
   if available" — falls back to the existing polling path on SSE
   connection failure.
2. Upsert-per-card in the v3 executor (already partially true; need
   to verify the cross-cell batching doesn't delay individual rows).
3. Frontend listens; if SSE disconnects, polls as today. No UX
   regression.

Pure 2.A rejected: the persistence bypass would surprise any
downstream consumer (dashboard, cross-device, skill replays).

## 4. API contract

### Backend — new route

```
GET /api/v1/mandalas/:id/videos/stream
  Accept: text/event-stream
  Authorization: Bearer <token> (onRequest: fastify.authenticate)
```

Response: SSE stream with the following event types:

```
event: card_added
data: {"id": "<cache_row_id>", "videoId": "...", "title": "...",
        "channel": "...", "thumbnail": "...", "durationSec": 720,
        "recScore": 0.87, "cellIndex": 3, "cellLabel": "...",
        "keyword": "...", "source": "auto_recommend",
        "recReason": "..."}

event: heartbeat
data: {"ts": 1745251234567}     // every 20s to keep conns alive

event: complete
data: {"added": 34, "ts": ...}   // pipeline finished for this mandala

event: error
data: {"code": "timeout|auth|internal", "message": "..."}
```

Client reconnect: EventSource retries by default; server responds
with `retry: 5000\n\n` at connection start.

Termination: `complete` event → server sends `event: end` → closes
connection. Client stops listening and falls back to `/recommendations`
for any stragglers.

### Frontend — new hook

```ts
// frontend/src/hooks/use-video-stream.ts
export function useVideoStream(mandalaId: string): {
  cards: RecommendationItem[];
  status: 'idle' | 'connecting' | 'streaming' | 'complete' | 'error';
} {
  // EventSource wrapper.
  // On card_added: append to cards state (dedupe by id).
  // On complete: status='complete', close.
  // On error: status='error', consumer falls back to polling.
}
```

Cards appear in the existing card components with a subtle
shimmer-fade transition. No new component types.

## 5. Implementation plan

### Slice 2 — backend (~6-8h)

Files:
- `src/api/routes/mandalas.ts` — new `/:id/videos/stream` handler.
  Uses Fastify's built-in SSE support or a minimal helper.
  Subscribes to Postgres channel `rec_cache:<mandalaId>`, forwards
  each notification as `card_added`, sends heartbeat on interval,
  cleans up on disconnect.
- `src/modules/recommendations/publisher.ts` (new) — wraps
  `prisma.$executeRaw` NOTIFY calls. Called from v3 executor after
  each `recommendation_cache.upsert`.
- `src/skills/plugins/video-discover/v3/executor.ts` — add
  `publisher.notify(mandalaId, row)` after each upsert. Safe no-op
  if publisher injection is null (keeps unit tests backend-free).
- Tests:
  - `tests/unit/modules/rec-publisher.test.ts` — pure unit test for
    NOTIFY payload shape.
  - `tests/smoke/mandalas-stream.test.ts` — integration smoke:
    spin up Fastify test instance, fire a NOTIFY, assert SSE event
    arrives.

Rollback: SSE route is additive. Existing `/recommendations` path
untouched.

### Slice 4 — frontend (~6-8h)

Files:
- `frontend/src/api/video-stream-client.ts` (new) — `EventSource`
  wrapper with reconnect backoff, status state.
- `frontend/src/hooks/use-video-stream.ts` (new) — React hook.
- `frontend/src/components/mandala/VideoCardsStreamed.tsx` (or
  similar; integrate into existing cards container). Falls back to
  `useRecommendations` polling on stream error or status=error.
- Tests:
  - `frontend/src/__tests__/hooks/use-video-stream.test.ts` —
    mock EventSource, assert card append + dedupe + error fallback.

Rollback: feature flag `VITE_VIDEO_STREAM_ENABLED` (default true in
dev, false in prod until verified). Flag off → legacy polling path.

### Infra / config

- Postgres `LISTEN/NOTIFY` requires a non-pooled connection. The
  existing Prisma client uses PgBouncer pooler (port 6543) for
  regular queries; we need a **dedicated direct-URL (5432) connection
  per SSE subscriber** for `LISTEN`. Plan: per-request connection
  via `new Client()` from `pg` directly; auto-close on
  `request.raw.on('close')`.
- Concurrent SSE connections: ~N per user. Cap at ~5 via Fastify
  rate-limit plugin. Disconnect older when exceeded.
- `INTERNAL_BATCH_TOKEN` not involved; this is user auth.

### Required approvals / Hard-Rule checks

- **Plan → Approve → Execute**: this doc is the plan. Awaiting user
  approval for implementation.
- **Cross-Layer Propagation**: L1 (route) + L2 (type contract in
  shared types file) + L3 (api-client) + L4 (hook) + L5
  (orchestrator-ish; the hook composes into existing cards
  container) + L6 (UI) — full chain.
- **Pre-push Verification**: frontend involvement → `/verify` PASS
  required before push.
- **D&D Protection**: cards container is inside the D&D context;
  modifications to the container must preserve `DndContext`
  placement. `/test-dnd` after.
- **Testing**: unit + smoke + integration tests per layer (per
  CLAUDE.md Testing rule).

## 6. Success metrics

Observable in prod logs:
- `[TIMING] stream-first-card-ms` emitted on first `card_added` per
  stream. Target p50 < 2000, p95 < 4000.
- `[TIMING] stream-total-cards` on `complete`. Should match
  pre-slice-2 `/recommendations` row count within ±5% (no drops).
- `[TIMING] stream-fallback-to-polling` counter when client falls
  back. Target < 2% of sessions.

## 7. Non-goals (for this slice pair)

- Replacing `/recommendations` entirely. It stays for history views
  and non-streaming clients.
- Cross-device notification of new cards (mandala open on laptop
  gets a card that browser tab on phone added). Phase 2 work.
- Prioritizing cards by arrival order vs relevance. Initial
  implementation appends by arrival; relevance re-sort happens
  client-side on `complete`.

## 8. Open questions

1. Do we invalidate an SSE connection if a **new** discovery run
   starts for the same mandala mid-stream? Proposed: yes, send
   `event: superseded`, client discards in-flight cards, reconnects
   fresh.
2. SSE connection limit per user — 5 reasonable? Refine after
   observing real usage.
3. Heartbeat interval — 20s leaves most CDNs/proxies happy. Verify
   the AWS EC2 / ALB setup doesn't idle-close earlier.

---

**Awaiting approval to begin Slice 2 implementation.**
