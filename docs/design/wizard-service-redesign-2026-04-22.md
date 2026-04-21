# Wizard/Dashboard Service-Flow Redesign — 2026-04-22

> Status: DESIGN ONLY. No code changes in this session.
> Supersedes: `docs/design/wizard-dashboard-redesign-2026-04-21.md` (previous session's Slice 1-5 + PRs #428-#439 — see §8 "Why the prior redesign failed").

## 0. Mission

**Deliver the best possible cards to the user as fast as possible, without misrepresenting progress.**

Every phase, every verification gate, every rollback trigger below is evaluated against this single statement. If a proposed change does not measurably improve one of the three axes — accuracy, completeness, speed — it is not in scope.

### Three axes of "best cards, fast"

| Axis | Definition | Primary metric |
|------|------------|----------------|
| **Accuracy** (정확성) | Every card surfaced to the user is actually relevant. Zero-target for false positives. | Precision on labelled prod sample |
| **Completeness** (완결성) | Every card that would be relevant actually reaches the user. Zero-target for silent drops. | Recall on labelled prod sample |
| **Speed** (속도) | Perceived wait from goal-submit → first relevant card. | Server-side `duration_ms` p50/p95 |

Per-cell card count is **not an axis** — a cell with one truly-relevant card beats a cell with ten off-topic cards.

## 1. Problem statement

User-reported regression on 2026-04-21:

- Template search ~7s
- "AI 커스텀" ~21s
- Cards rendering ~30s+
- Cards per cell sparse (1 per cell in multiple cells)
- Off-topic cards passing the relevance filter (e.g. 수능 입시 content under "AI 학습 로드맵" mandala)

Net result: **worse than the pre-CP389 baseline**. User judgement: "짜깁기 patch 누적".

## 2. Constraints (explicit, non-negotiable)

- **C1** — Service/prod main path uses **OpenRouter** for all LLM + embedding calls. No exceptions for "small test" or "just one".
- **C2** — Self-hosted models (Ollama, qwen3-embedding:8b, qwen3-4b, mandala-gen v13) are **R&D / post-processing / backfill only**. They MUST NOT sit on the service critical path — not as primary, not as a blocking parallel dependency.
- **C3** — Filter purpose is **user receives relevant cards**, not "reduce card count per cell". Silent drop of a relevant card is the worst outcome.
- **C4** — Plan → Approve → Execute. No code/deploy without explicit approval per change.
- **C5** — 1 change / 1 deploy / 1 prod measurement. No layered deploys.

### Operating rules (how each phase is executed, not what)

- **R1** — No improvement claimed without prod measurement. "Theoretical 60s → 10s" is never an acceptance signal.
- **R2** — If a phase fails its verification gate, report "effect: none / regression" honestly and roll back. Sunk cost and reputation are ignored.
- **R3** — Symptom patches are forbidden. A phase ships only when the root cause is identified and the change targets it directly.
- **R4** — Synthetic fixtures alone are never an acceptance gate. Real prod data (≥ 3 distinct mandalas, ≥ 50 cards each) is mandatory.
- **R5** — Scope creep is forbidden. Any "while we're here, let's also…" triggers a new design doc, not an in-flight addition.

## 3. Current-state violations (audit)

Evidence from source + prod env (read-only, 2026-04-22):

| # | Service-flow path | Calls out to | Blocking? | Violation of |
|---|-------------------|--------------|-----------|--------------|
| V1 | `POST /search-by-goal` → `embedGoalForMandala` | `MANDALA_GEN_URL=http://100.91.173.17:11434` (mac mini Ollama) | Yes, ~5s typical | C1, C2 |
| V2 | `POST /mandalas/generate` → `generateMandalaWithHaiku` / v13 | Same mac mini Ollama | Yes, ~20-28s typical | C1, C2 |
| V3 | `ensureMandalaEmbeddings` | Same mac mini Ollama | Yes | C1, C2 |
| V4 | Template similarity search reads `mandala_embeddings` (qwen3 4096d) | DB table populated by V3 | Reads non-blocking, but vector space is qwen3 — service gate semantically depends on mac-mini-produced vectors | C1 indirect |

**Source references**:
- `src/modules/mandala/search.ts:5` — "Embed user goal with Qwen3-Embedding-8B (4096d) **via Mac Mini Ollama**"
- `src/modules/mandala/search.ts:63` — same
- `src/modules/mandala/generator.ts:4-5` — "Model is **served on Mac Mini via Ollama API**"
- `src/modules/mandala/ensure-mandala-embeddings.ts:165` — "Step 4: generate **via Mac Mini Ollama**"
- `src/config/index.ts:58-62` — `MANDALA_GEN_URL`, `MANDALA_EMBED_MODEL=qwen3-embedding:8b`, `MANDALA_EMBED_DIMENSION=4096`
- Prod env: `MANDALA_GEN_URL=http://100.91.173.17:11434` (mac mini Tailscale IP)
- Prod env: `OPENROUTER_MODEL=qwen/qwen3-30b-a3b` (OpenRouter already configured for other v3 calls; not wired to mandala generate/embed)

## 4. Structural root cause

**The wizard waits for mac mini.** Two mac-mini-Ollama calls dominate wall-clock:
- Template embed (~5s) — on critical path even when user may never click a template
- Mandala generate (~21-28s) — on critical path, user blocks on this

Every prior "speed improvement" PR optimized around these two calls without replacing them:

| Prior PR | Effect relative to mac-mini wait |
|----------|----------------------------------|
| #428 YouTube per-call timeout | Orthogonal (post-creation path) |
| #434 wizard-stream parallel SSE | Parallelizes V1 ‖ V2 → `max(5s, 25s) = 25s` — **still blocked by V2** |
| #435 save + skill + card subscribe | Orthogonal (post-creation path) |
| #436 useWizardStream hook | UI only, latency floor unchanged |
| #437 stream view flag-gate | UI only |
| #438 auto-add notify publisher | Orthogonal (post-creation path) |
| #439 IndexPage SSE subscribe | UI only; helps S3 `cards 30s` per-card append but mandala-create wait unchanged |

So a valid latency improvement is **structurally impossible** without replacing V1+V2+V3. That replacement is the scope of this redesign.

## 5. Card relevance — reframed

User framing (accepted):

> 필터의 목적은 카드수를 줄이는게 아니야, 불필요한 관련없는 카드를 제외해서 사용자가 필요한 카드를 받아 볼수 있게 하는 것이 목표야.

Implications:
- Metric is **"user received relevant cards"**, not "gate pass rate" or "cards per cell".
- **Silent drop** of a relevant card is worse than a visible false positive (user can dismiss the visible one; they can't recover the invisible one).
- `V3_CENTER_GATE_MODE` (substring/subword/off) **all fail** this framing:
  - `substring`: silently drops composite-word matches (PR #432 "2/64 outage" pattern)
  - `subword`: lets "하는" / "학습" bigrams through → false positives (2026-04-21 prod)
  - `off`: sub_goal jaccard takes over, also token-based → same silent-drop class
- Therefore **all token-based gates are deprecated**. Replacement: **semantic embedding gate**.

## 6. Target architecture

### 6.1. Two vector spaces

**Space A — Service (OpenRouter)**  *[critical path, authoritative for gate]*
- Model: one OpenRouter embedding model (selected in Phase 0)
- Tables:
  - `mandala_embeddings_service` — center_goal + 8 sub_goals, service-space embedding
  - `video_meta_embeddings_service` — YouTube title + description, same space
- Read path: cosine (`title_embed` vs `center_goal_embed`) for center gate; argmax over 8 sub_goal embeds for cell routing.
- Write path: at mandala create (center/sub), at YouTube search result (title/desc).

**Space B — R&D (mac mini qwen3)**  *[non-blocking, parallel]*
- Existing `mandala_embeddings` (qwen3 4096d) repurposed as read-only R&D baseline.
- New `video_meta_embeddings_qwen3` populated asynchronously by mac mini consuming a queue of the same inputs the service just embedded.
- Never read on service path. Used for offline A/B quality eval (qwen3 vs OpenRouter) and future self-host re-adoption decisions.

### 6.2. Service flow (new)

```
User submits goal
      │
      ▼
POST /wizard-stream (existing route, already deployed)
      │
      ├── [OpenRouter] embed(center_goal) + embed(sub_goals × 8)
      │        ↓
      │   mandala_embeddings_service ← insert
      │        ↓
      │   pgvector similarity → template_found SSE event
      │
      ├── [OpenRouter] generate structure (replaces mac mini v13)
      │        ↓
      │   structure_ready SSE event  ← user can navigate here
      │        ↓
      │   mandala row saved
      │        ↓
      │   [async] v3 post-creation pipeline (existing, unchanged)
      │        ↓
      │   YouTube search returns ~50-100 candidate titles
      │        ↓
      │   [OpenRouter] embed(title+desc × N, batched or concurrent)
      │        ↓
      │   video_meta_embeddings_service ← insert
      │        ↓
      │   SEMANTIC GATE:
      │     cosine(title_embed, center_embed) ≥ threshold  →  pass
      │     argmax(title_embed · sub_goal_embeds[8])       →  cell
      │        ↓
      │   recommendation_cache ← upsert surviving rows
      │        ↓
      │   card_added SSE event per row (PR #438/#439 path, retained)
      │
      └── [fire-and-forget to mac mini queue] same inputs
             ↓
           mac mini qwen3 embed/generate → *_qwen3 tables (R&D)
```

Key properties:
- Zero mac-mini calls on critical path.
- `template_found` still arrives (now bounded by OpenRouter embed + pgvector RTT; target <1s).
- `structure_ready` now bounded by OpenRouter LLM latency, not mac mini Ollama.
- Cards arrive streaming; cell assignment via semantic argmax, not token jaccard.

### 6.3. Deprecations

After this redesign lands in full (phase 5):
- `V3_CENTER_GATE_MODE` env + subword/substring/off logic — **removed**
- `charBigrams`, `subwordOverlap`, `substringOverlap` — **removed**
- `MANDALA_GEN_URL`, `MANDALA_EMBED_MODEL`, `MANDALA_EMBED_DIMENSION` env — **renamed to `MANDALA_GEN_URL_RND` / `MANDALA_EMBED_MODEL_RND`** (R&D only) or deleted if no R&D consumer exists.

## 7. Implementation phases

Each phase is independently deployable, independently rollback-able, and independently measurable. No phase merges with another.

### Phase 0 — Model selection (documented-benchmark review, no API calls)

**Axis**: supports R1 + R4 (decision record for downstream phases). No direct axis improvement.

**Hard-rule note (2026-04-22 revision)**: Original Phase 0 proposed an empirical OpenRouter embed sweep. That violated CLAUDE.md rule "LLM API 호출 금지 — OpenRouter API 호출 금지 — 어떤 명목도 불가". Replaced with **document-only review** below. Empirical measurement happens during Phase 1 deploy's own verification gate; no standalone measurement script is written or run.

**Scope (no code, no API calls)**:
- Compare candidate OpenRouter embedding endpoints using **published benchmarks** (MTEB multilingual, model cards, OpenRouter model list) + **training-knowledge-derived tradeoffs**.
- Cross-reference with existing Insighta constraints (4096d qwen3 schema precedent, Korean-primary traffic, OpenRouter already configured at `OPENROUTER_MODEL=qwen/qwen3-30b-a3b`).
- Publish a recommendation + fallback (Appendix A of this doc).
- Get user approval on one model before Phase 1 starts.

**Output artifact**: Appendix A below.

**Verification gate**: user-approved model choice recorded. That choice is the only input to Phase 1. If Phase 1 deploy misses its rollback triggers (see Phase 1 rollback triggers), the model is declared unfit and the next-ranked fallback in Appendix A is used for the retry.

### Phase 1 — Service embedding path migration

**Axis**: **Speed primary** (target: embed p95 5s → <500ms, search-by-goal p95 8s → <1.5s). Completeness secondary (same-space gate vectors enable Phase 3).

Scope: replace V1/V3 with OpenRouter embed.

Files touched:
- `src/modules/mandala/search.ts:embedGoalForMandala` — swap fetch target
- `src/modules/mandala/ensure-mandala-embeddings.ts` — swap embed source
- New Prisma migration: `mandala_embeddings_service` table with pgvector dim matching Phase-0 choice
- New raw SQL migration: IVFFlat index on the new table (`CREATE INDEX CONCURRENTLY`)
- `src/config/index.ts` — new `openRouter.embedModel` config entry; keep `mandalaGen` block renamed `_RND` suffix

Not touched this phase:
- `V3_CENTER_GATE_MODE`, token-based filter logic, cards pipeline, wizard UI — all unchanged.
- `generator.ts` (that's Phase 2).

**Verification gate (prod)**:
- `embedGoalForMandala` call time p95 < 500ms (was ~5s on mac mini)
- Template search-by-goal end-to-end p95 < 1.5s (was ~8s)
- No increase in 5xx rate on `/search-by-goal` over 24h
- Prod smoke: create 1 mandala, verify `mandala_embeddings_service` row exists, dim matches

**Rollback triggers (any one fires → revert within 24h)**:
- Embed p95 ≥ 2s (missed target by 4×)
- `/search-by-goal` 5xx rate > baseline + 1pp
- Cosine similarity distribution on new space shows mean < 0.20 on known-relevant pairs (indicates wrong model choice)

**Rollback mechanism**: config flag `MANDALA_EMBED_PROVIDER=ollama` temporary — re-route to mac mini endpoint. No data migration needed (old table untouched).

### Phase 1b — Mac mini concurrent embedding queue  *(immediately after Phase 1 verification)*

**Axis**: **R&D data accumulation** — enables future A/B eval, future self-host re-adoption, and vector-level comparison between OpenRouter qwen3 and mac mini qwen3 (same family, same dim). Does not directly improve Accuracy / Completeness / Speed, but is a day-1 prerequisite for any future model-quality improvement work (per user directive 2026-04-22: "mac mini는 동시에 호출되어 후처리로 데이터를 쌓아서 이후 모델, 혹은 임베딩을 개선하기 위한 용도").

Scope: after Phase 1 deploy is verified and stable, add fire-and-forget enqueue of the same embedding inputs to mac mini. Service flow remains unaffected (never waits on mac mini).

Files touched:
- New pg-boss job type `mac_mini_embed_rnd`
- `src/modules/mandala/search.ts` after OpenRouter embed call — enqueue same goal text + mandala_id reference
- Mac mini side: queue consumer invokes local Ollama `qwen3-embedding:8b`, writes results to `mandala_embeddings_qwen3` (R&D table; either new, or the existing `mandala_embeddings` explicitly repurposed as R&D-only)

**Verification gate**:
- Job lag ≤ 5 min under normal load
- Zero service-flow latency impact (`embedGoalForMandala` p95 post-Phase-1b equals pre-Phase-1b baseline, tolerance ≤ 50ms)
- R&D table populated within 5 min of service embed for ≥ 95% of inputs

**Rollback triggers (any fires → revert within 24h)**:
- Service `embedGoalForMandala` p95 increases > 100ms after Phase 1b deploy (queue insert overhead too high)
- Queue backlog grows unbounded (mac mini consumer too slow, queue saturates)

**Rollback mechanism**: set queue throttle to 0 via config; no service flow impact.

### Phase 2 — PWA auto-update + wizard-stream activation

**Axis**: **Speed primary** (target: user-visible wizard wait 21-28s → ~3-5s by switching users from legacy one-shot path to already-deployed streaming path).

**Re-scope note (2026-04-22 post-merge, v6)**: Original Phase 2 proposed migrating mac-mini mandala-gen to OpenRouter. Code audit on `feat/phase2-openrouter-generate` branch showed all user-blocking LLM paths ALREADY use OpenRouter:
- `generateMandalaStructure` → OpenRouter STRUCTURE_MODEL
- `generateMandalaActions` → OpenRouter ACTIONS_MODEL
- `generateMandalaWithHaiku` (primary for legacy wizard) → OpenRouter `claude-haiku-4.5`
- `generateMandala` (mac mini) is only called as `void` fire-and-forget in `generateMandalaRace` for LoRA training-data accumulation — non-blocking, matches user's "mac mini = R&D accumulator" rule.

So the 21-28s S2 symptom is **OpenRouter Haiku one-shot (1902 tokens) latency**, not mac mini. The `wizard-stream` route already routes through the fast `generateMandalaStructure` path (~3s), but users cannot reach that code because VitePWA `registerType: 'prompt'` keeps them on the old cached JS bundle. Phase 2 redirected to fix that.

Scope:
- `frontend/vite.config.ts` — `registerType: 'prompt'` → `'autoUpdate'`
- `frontend/src/main.tsx` — adjust `registerSW` call so the new worker takes over at next navigation (not mid-session)
- Remove `/api/*` from workbox `runtimeCaching` — API responses must not be stale-served from the service worker
- No backend code change

**Verification gate**:
- Post-deploy: `POST /api/v1/mandalas/wizard-stream` call count rises from 0 to >0 in prod within 24h (proves users are now on the new bundle)
- Wizard user-visible wait p95 < 10s (structure_ready event time captured server-side)
- No increase in `/api/*` 5xx rate over 24h (confirms SW cache change didn't break anything)

**Rollback triggers (any one fires → revert within 24h)**:
- Wizard-stream call count stays 0 after 24h (SW update didn't propagate)
- Any user-reported "wizard broken / stuck" within 48h
- Prod 5xx rate on `/api/*` increases > 1pp vs pre-deploy baseline (SW-cache-induced)

**Rollback mechanism**: revert the frontend PR (1 commit). SW will self-expire its cached assets on next deploy; worst case a user hard-refresh.

### Phase 2' (deferred) — Optional cleanup: isolate mac-mini LoRA fire-and-forget

Not in this redesign's critical path. `generateMandala` + `prewarmMandalaModel` are already correctly isolated behaviorally (R&D-only). A future cleanup PR may move them from `generator.ts` into a separate `legacy-lora-background.ts` module for code clarity, but this is cosmetic — no functional change. Deferred.

### Phase 2b — Mac mini concurrent generation queue  *(immediately after Phase 2 verification)*

**Axis**: Same as Phase 1b — R&D data accumulation for mandala-gen v13 outputs (mac mini) alongside OpenRouter structure generation (service). Enables A/B comparison of generated structures for quality improvement over time.

Scope: analogous to Phase 1b, for the mandala-generate path. Service flow never waits on mac mini.

Files touched:
- New pg-boss job type `mac_mini_generate_rnd`
- `src/modules/mandala/generator.ts` after OpenRouter structure generation — enqueue same goal + structure reference
- Mac mini side: queue consumer invokes local mandala-gen v13, writes result to `mandala_generations_qwen3_rnd` table (new)

**Verification gate**: same pattern as Phase 1b (job lag ≤ 5 min; zero service-flow latency impact; R&D table populated for ≥ 95% of service generations).

**Rollback triggers**: same pattern as Phase 1b (service `structure_ready` p95 regression > 100ms; unbounded queue backlog).

**Rollback mechanism**: set queue throttle to 0 via config; no service flow impact.

### Phase 3 — Semantic relevance gate

**Axis**: **Accuracy + Completeness primary** (this is the axis where the whole redesign pays off). Speed neutral (adds one batched embed call per search, latency budget <1s).

Scope: replace token-based `V3_CENTER_GATE_MODE` with OpenRouter-embedding cosine gate.

Files touched:
- New table `video_meta_embeddings_service` (video_id PK, embedding vector(N), created_at)
- `src/skills/plugins/video-discover/v3/executor.ts` — after YouTube search, embed titles + descriptions; store; feed to gate
- New module `src/skills/plugins/video-discover/v3/semantic-gate.ts` — cosine + threshold + argmax routing
- `src/skills/plugins/video-discover/v3/mandala-filter.ts` — `V3_CENTER_GATE_MODE=semantic` new branch, old branches untouched during transition
- Threshold env `V3_SEMANTIC_GATE_THRESHOLD` (default from Phase-0 sweep)

Token branches (substring/subword/off) remain until Phase 5, for rollback.

**Verification gate**:
- Relevance metric on labelled sample (user-verified or agent-labelled sample from real prod mandalas): precision ≥ 0.85, recall ≥ 0.85 (vs current subword precision < 0.60 on AI-학습 mandala)
- No card count per cell target — cells may be empty or may have 20 cards, per content. Per-cell count is informational only.
- Full per-mandala semantic-gate stats logged (drop count + reason + below-threshold scores) for post-hoc inspection

**Rollback triggers (any one fires → revert within 24h)**:
- Precision < 0.85 on labelled sample of ≥ 100 cards across ≥ 3 mandalas
- Recall < 0.85 on same sample
- Latency p95 increase > 500ms on full wizard flow vs Phase-2-deployed baseline
- Any user-reported "fewer relevant cards than before" within 72h

**Rollback mechanism**: `V3_CENTER_GATE_MODE=subword` (existing legacy path restored).

### Phase 4 (former) — split into Phase 1b and Phase 2b

The original v1-v3 design put mac-mini R&D data accumulation as a "Phase 4 backburner — may never land". That classification was incorrect per user's 2026-04-22 directive: mac mini must be concurrently collecting data from day 1. Phase 4's responsibilities are now Phase 1b and Phase 2b (inline above, immediately after their paired service-path phases).

### Phase 5 — Token gate removal

**Axis**: **none directly**. Maintenance cleanup — reduces code-base risk of accidental re-activation. Gate-kept by sustained Phase-3 success.

Scope: delete all token-based center-gate code after 4 weeks of green Phase-3 metrics.

Files touched:
- Remove `charBigrams`, `subwordOverlap`, `substringOverlap`, `V3_CENTER_GATE_MODE` from `mandala-filter.ts` + `config.ts`
- Remove `V3_CENTER_GATE_MODE` env from `docker-compose.prod.yml`
- Delete `scripts/verify-mandala-filter-hypothesis.ts` (replaced by Phase-3 live metrics)

**Verification gate**: 4 consecutive weeks of Phase-3 precision ≥ 0.85. No user-reported relevance regression open.

## 8. Why the prior redesign failed (reference, not action)

From `docs/design/wizard-dashboard-redesign-2026-04-21.md` + PRs #428-#439:

- The prior redesign parallelized V1 ‖ V2 but kept both on mac mini. Wall-clock floor = max of two mac-mini calls = still mac mini-bound.
- It did not identify mac mini as the latency root cause (attributed to "sequential awaits" instead).
- The subword `V3_CENTER_GATE_MODE` follow-up (PR #432 + chore #433) was fixture-validated but the fixture did not represent prod distribution; real prod produced the 2026-04-21 false positives documented in §5.
- The streaming wizard UI (PR #437) landed with `VITE_WIZARD_STREAMING_ENABLED` default-on, but VitePWA `registerType: 'prompt'` kept users on the old cached bundle → zero measured activation.
- No per-PR prod measurement gate. "CI pass" treated as acceptance criterion → measurement debt compounded.

This redesign addresses each of those failure modes explicitly via §2 C5 (1 change / 1 deploy / 1 measurement) and §7 per-phase verification gates.

## 9. Measurement framework

### 9.1. Primary metric

**Relevance rate** = (user-kept cards) / (cards surfaced to user) over N days. Proxy signals until explicit user feedback exists:
- Cards NOT deleted / dismissed within 7 days (positive)
- Cards deleted within 24h of surface (negative)
- Cards clicked (positive, but noisier — click != relevant)

### 9.2. Secondary metrics

- Server-side `duration_ms` per SSE event (already emitted by wizard-stream route)
- Card-surface latency p50/p95 (mandala create → first card rendered)
- Cell distribution per mandala (informational; no target)

### 9.3. No synthetic fixtures as acceptance gate

Phase 0 may use synthetic fixtures for model comparison. Phase 1-3 acceptance uses **real prod mandalas only** (at least 3 distinct goals, at least 50 cards per mandala).

## 10. Out of scope for this redesign

- PWA `registerType: 'prompt'` → `'autoUpdate'` migration. Separate ops PR, see `docs/design/` follow-up.
- `mandala_embeddings` 18,009-row backfill in new space. Handled as a one-off script in Phase 1 (offline; doesn't block deploy).
- wizard-stream UI activation for users still on cached old bundle. Handled by the PWA ops PR above.
- Per-cell yield balancing (`MIN_CARDS_PER_CELL` env). Removed — §5 reframing says per-cell count is not a metric.
- pgvector IVFFlat on old `mandala_embeddings` table. The new `_service` table gets IVFFlat from day 1; the old table is R&D-only and its index is out of scope.

## 11. Open questions

- ~~**Q1** — OpenRouter embedding model choice.~~ **DECIDED 2026-04-22**: `qwen3-embedding-8B`. See Appendix A.6.
- **Q2** — OpenRouter generation model for mandala structure. Current prod has `OPENROUTER_MODEL=qwen/qwen3-30b-a3b`; this may stay, or move to Haiku/Sonnet based on Phase 2 deploy metrics.
- **Q3** — Relevance threshold value for Phase 3 semantic gate. Answered by Phase 3 production calibration on labelled prod data.
- ~~**Q4** — Backfill strategy for 18,009 existing `mandala_embeddings` rows.~~ **DECIDED 2026-04-22**: reuse as-is (same model family, same 4096d); re-embed only if Phase 1 rollback trigger fires. See Appendix A.6.
- **Q5** — Mac mini consumer infrastructure. Does mac mini already have pg-boss / queue consumer plumbing? If not, Phase 1b/2b carry that cost.
- **Q6** — OpenRouter rate limits / burst ceiling for qwen3-embedding-8B. Per-provider; verify during Phase 0 closeout (reading OpenRouter docs) or deferred until Phase 1 deploy reveals ceiling.

## 12. Non-goals

- Building a generic embedding abstraction library.
- Replacing OpenRouter itself (it's the service-flow provider by C1).
- Touching unrelated recommendation mechanics (auto-add, localCards, sync, etc.).

## 13. Change log

- 2026-04-22 (v1) — Initial redesign after user identified mac mini in service critical path; prior `wizard-dashboard-redesign-2026-04-21.md` superseded.
- 2026-04-22 (v2) — Added §0 Mission statement and three-axis definition (accuracy / completeness / speed). Added §2bis Operating Rules (R1-R5). Tagged every phase with its primary+secondary axis. Replaced generic "verification gate" with quantitative rollback triggers per phase. Marked Phase 4 as backburner and Phase 5 as maintenance-only (neither improves the three axes directly). Reason: user statement — "사용자에게 최고의 카드를 빠르게 제공하는 것을 위한 서비스를 거짓없이 올바르게 정확한 알고리즘을 사용해서 가장 효과적으로 구현하는 것".
- 2026-04-22 (v3) — Phase 0 revised: original empirical-sweep plan violated CLAUDE.md rule on OpenRouter API usage ("데이터셋 생성·실험·테스트 사용 절대 금지"). Replaced with documented-benchmark review (no API calls). Empirical measurement happens during Phase 1 deploy's verification gate. Added Appendix A — candidate model comparison.
- 2026-04-22 (v4) — Phase 4 reclassified. User clarified: mac mini "동시에 호출되어 후처리로 데이터를 쌓아서 이후 모델/임베딩 개선" — concurrent collection is day-1 architecture, not deferred backburner. Phase 4 split into **Phase 1b** (concurrent embedding queue) and **Phase 2b** (concurrent generation queue), each deployed immediately after its paired service-path phase is verified.
- 2026-04-22 (v5) — Model decision recorded in Appendix A.6. Primary: `qwen3-embedding-8B` via OpenRouter (user confirmed availability). Fallback order: Cohere multi-v3 → openai-3-small → openai-3-large. Existing 18,009 `mandala_embeddings` rows reused as-is (same family, same 4096d). Updated A.1 candidate set to mark qwen3-8B primary; updated A.2 quality ranking; updated A.3 operational table with latency+cost estimates and compatibility row; rewrote A.4 recommendation; converted A.6 from "decision required" to "decisions recorded". Resolved §11 Q1 and Q4.
- 2026-04-22 (v6) — Phase 2 re-scoped. Phase 1 (PR #440) merged as `d87f0e3`. Follow-up audit on `feat/phase2-openrouter-generate` revealed that all user-blocking LLM paths already use OpenRouter (STRUCTURE_MODEL, ACTIONS_MODEL, claude-haiku-4.5); mac-mini `generateMandala` is already a `void` fire-and-forget LoRA-data accumulator (matches user's R&D rule). Original "replace mac-mini generate with OpenRouter" target is therefore invalid. The real S2 lever is user activation: wizard-stream route is deployed but VitePWA `registerType: 'prompt'` keeps users on the old cached bundle. New Phase 2 = PWA auto-update + workbox `/api/*` cache removal. Phase 2' (cosmetic isolation of mac-mini LoRA) deferred.

---

## Appendix A — OpenRouter embedding model selection (2026-04-22)

> All claims in this appendix are sourced from **published benchmarks and model cards available in training knowledge up to 2026-01**. No API calls were made to produce this document. Prod latency / cost / cosine-separation numbers for our specific Korean-goal distribution will first be observable during the Phase 1 deploy verification window.

### A.1. Candidate set

**Primary (user-confirmed available on OpenRouter, 2026-04-22)**:

| Model | Dim | Architecture | OpenRouter availability |
|-------|-----|--------------|-------------------------|
| **`qwen3-embedding-8B`** | **4096** | Same family as mac mini `qwen3-embedding:8b` (Q4_K_M) | **Confirmed (user)** |

Chosen because:
- Top-tier Korean semantic quality (MTEB multilingual top class)
- **Same model family and dimension as the existing mac mini R&D path** — existing 18,009 `mandala_embeddings` rows remain usable without re-embedding (see A.4 caveat)
- Existing `mandala_embeddings` table schema (`vector(4096)`) and any attached pgvector index are reusable

**Fallbacks (in case OpenRouter qwen3-embedding-8B provider becomes unavailable or fails Phase 1 rollback triggers)**:

| Fallback rank | Model | Dim | Price / 1M tok | Max input | Availability |
|---------------|-------|-----|----------------|-----------|--------------|
| 1 | `cohere/embed-multilingual-v3.0` | 1024 | $0.10 | 512 | Confirmed |
| 2 | `openai/text-embedding-3-small` | 1536 | $0.02 | 8,191 | Confirmed |
| 3 | `openai/text-embedding-3-large` | 3072 | $0.13 | 8,191 | Confirmed |

Omitted:
- `voyage/voyage-multilingual-2` — Voyage typically requires direct API; OpenRouter routing unverified.
- `openai/text-embedding-ada-002` — legacy, strictly dominated by `text-embedding-3-small`.
- Self-hosted BGE / E5-multilingual via OpenRouter — unreliable multi-provider routing; would muddy the "OpenRouter main, self-host R&D" separation.

### A.2. Relevance quality (Korean-focused)

Ranked by MTEB multilingual benchmarks + published Korean-task evaluations as of training cutoff:

| Rank | Model | Published multilingual avg | Korean-specific strength |
|------|-------|----------------------------|-------------------------|
| **1** | **`qwen3-embedding-8B`** | **~67 avg on MTEB multilingual** (top tier) | **Strongest in candidate set** — pretrained with large Korean + CJK corpus; same family currently in use on mac mini as existing R&D path |
| 2 | `cohere/embed-multilingual-v3.0` | ~64 avg on MTEB multilingual | Trained explicitly with Korean + CJK corpus; strong cross-lingual alignment |
| 3 | `openai/text-embedding-3-large` | ~62 avg on MTEB multilingual | English-dominant pretraining; Korean decent but not best-in-class |
| 4 | `openai/text-embedding-3-small` | ~58-60 avg on MTEB multilingual | English-dominant; Korean acceptable, consistently behind multilingual-specialized models |

**Uncertainty**: benchmark averages may not match our specific task (Korean goal ↔ Korean+English YouTube title cosine). Phase 1 deploy metrics are the authoritative signal.

### A.3. Operational considerations

| Axis | `qwen3-embedding-8B` | `cohere/multi-v3` | `openai/3-small` | `openai/3-large` |
|------|----------------------|-------------------|------------------|------------------|
| Storage cost per vector (f32) | 16 KB | 4 KB | 6 KB | 12 KB |
| pgvector IVFFlat index build time | slow | fastest | fast | slower |
| Korean-dominant workload precedent | strong (same family on mac mini) | strong | moderate | moderate |
| Max input sufficient for title+desc? | ✓ | ✓ (512 — titles typ. ≤ 200 tok) | ✓ (8k) | ✓ (8k) |
| Estimated per-call latency (short text) | ~300-800ms (cloud, warm) | ~150-300ms | ~100-200ms | ~150-300ms |
| Estimated batch-100 latency | ~1-2s | ~300-600ms | ~200-500ms | ~300-700ms |
| Cost per mandala (5.5k tok) | provider-dependent; expected <$0.01 | ~$0.00055 | ~$0.00011 | ~$0.00072 |
| **Compatibility with existing 18k rows** | **full (same family, same dim)** | none (1024d) | none (1536d) | none (3072d) |

Cost is trivially affordable at our scale across all candidates; **not the deciding factor**.

Latency of qwen3-8B is ~200-500ms slower than Cohere per call. Wizard-flow total: qwen3 = ~9-14s user-visible; Cohere = ~8-12s user-visible. Difference below perceptual threshold when weighed against quality and migration-free reuse of existing 18k rows.

### A.4. Recommendation (ranked) — **USER DECISION: qwen3-embedding-8B selected (2026-04-22)**

**Primary (selected)**: `qwen3-embedding-8B` via OpenRouter
- Top-tier Korean multilingual quality; exceeds all fallbacks on published Korean benchmarks
- **4096d matches existing `mandala_embeddings` schema** — no new vector space, 18,009 existing rows remain usable as template pool from day 1
- Existing pgvector infrastructure (vector(4096) column) reusable; no schema migration for the embedding column itself
- Same model family currently running on mac mini as R&D baseline → vector-level A/B comparison between service and R&D paths is possible

**Caveat (precision drift)**:
- Mac mini uses `Q4_K_M` (4-bit quantization via Ollama llama.cpp)
- OpenRouter provider will likely serve higher precision (BF16/FP16/Q8)
- Resulting vectors are **not bit-identical** but same architecture → cosine rankings preserved (error typ. <1% on top-10)
- Absolute cosine thresholds need Phase 3 calibration anyway (already in plan §9.2)
- Phase 1 rollback trigger ("cosine mean < 0.20 on known-relevant pairs") catches pathological drift

**Fallback 1 (if OpenRouter qwen3-embedding-8B provider is unavailable or fails Phase 1 rollback triggers)**: `cohere/embed-multilingual-v3.0`
- Strong Korean multilingual, confirmed OpenRouter-hosted
- 1024d → new vector space → existing 18k rows need re-embed (one-shot ~$0.18 + 3-10 min)

**Fallback 2**: `openai/text-embedding-3-small`
- Cheapest, most widely deployed, OpenAI SLA stable
- 1536d, new vector space, same re-embed cost as Fallback 1

**Fallback 3**: `openai/text-embedding-3-large`
- Use only if quality signal demands it
- 3072d doubles storage and index cost

### A.5. What this appendix does NOT provide

- Empirical latency measurements on our prod network — captured during Phase 1 deploy's verification window.
- Empirical cosine-separation measurements on our specific labelled prod sample — captured during Phase 1 smoke and Phase 3 relevance evaluation.
- Proof that benchmark averages translate to our Korean-goal distribution — verified only by Phase 1 + Phase 3 prod metrics.
- Cost of mis-pick — mitigated by rollback triggers. A wrong primary pick costs one Phase 1 deploy + revert cycle (~1 day).

### A.6. Decisions recorded

**2026-04-22 (user approval)**:
- **Primary model**: `qwen3-embedding-8B` via OpenRouter. Same family and 4096d as existing mac mini R&D path.
- **Fallback order**: Cohere multilingual-v3 → openai-3-small → openai-3-large.
- **Existing 18,009 `mandala_embeddings` rows**: reused as-is in service flow. No re-embed at Phase 1 start.
- **Rollback protection**: Phase 1's "cosine mean < 0.20 on known-relevant pairs" trigger catches any quantization drift between Ollama Q4_K_M and OpenRouter provider precision. If fired, one-shot re-embed of the 18k rows (~$0.18, 3-10 min) before retry.
