# Wizard → Dashboard Performance Experiments Log

**Purpose**: 위저드 저장 → 대시보드 카드 노출 e2e 체감 지연 회복 작업의 **running ledger**. 새 실험 착수 / 실측 결과 확인 / 롤백 시 반드시 이 파일을 먼저 업데이트. 한 번의 정리 문서가 아니라 지속 관리 대상.

**Owner**: 위저드-대시보드 성능 arc 에 직접 commit 하는 세션이 갱신 책임. 최소 CP 단위 갱신.

**Last updated**: 2026-04-23 (CP419 말, PR #466 merged + CP417/CP418/CP419 event ingest + notation retrofit)

**Notation discipline (CP419 도입)**: 모든 latency / count 수치는 **`n=` · `mandala_id=` · `measured_at=UTC`** 3종 주석 필수. 단일 샘플은 `n=1` 로 명시하고 median/p50 등 집계값은 `n=N` 으로 구분. Aggregate claim (예: "60s → 3.1s, 19× 단축") 은 **pre/post pair (mandala 지정) 또는 집계 (n 지정)** 둘 중 하나로 표기. `semanticGateEmbedMs=0` 은 **병목 제거가 아니라 `V3_CENTER_GATE_MODE=subword` 로 semantic gate 경로를 우회 (lexical fallback)** — Phase 3 재활성 시 다시 측정 필요.

---

## Tracked metrics (user-visible, end-to-end)

| ID | 정의 | 측정 소스 |
|----|------|-----------|
| M1 | 템플릿 만다라트 생성 시간 (wizard save complete) | 사용자 stopwatch + `[mandala-create-timing]` log |
| M2 | AI custom 만다라트 생성 시간 | 사용자 stopwatch + `[mandala-create-timing]` log |
| M3 | 대시보드 첫 카드 노출 (mandala open → first card render) | 사용자 체감 + RecommendationFeed mount → first `<VideoCard>` |
| M4 | 대시보드 24 카드 채움 (mandala open → 24 cards visible) | 사용자 체감 |
| M5 | action slot fill rate (target 64 = 8 cells × 8 subjects) | `generation_log` + `user_mandala_levels.subjects` |
| M6 | card pool size (`recommendation_cache` rows per mandala) | SQL `count(*) where mandala_id=$1` |
| M7 | `tx_levels_createMany` wall time (prod log) | `[mandala-create-timing]` 구조 |
| M8 | center gate drop rate (Tier 1) | `video-discover v3` stage observability |
| M9 | cell assignment drop (Tier 2) | 동일 |

---

## Baselines

> 모든 값은 user stopwatch / prod telemetry / SQL count 중 출처 명시. 단일 샘플은 mandala_id 포함, 집계는 n 포함.

| Metric | CP388 기점 (2026-04-15) | CP416 중반 보고 (2026-04-22 오전) | CP418 post-rollback (2026-04-22 오후) | CP419 최신 (2026-04-23) |
|--------|-------------------------|-----------------------------------|---------------------------------------|--------------------------|
| M1 (템플릿 save) | 측정 없음 | **7s** (user stopwatch, n=1, mandala unspec, measured_at=2026-04-22 morning) | 미재측정 | 미재측정 |
| M2 (AI custom save) | 측정 없음 | **21s** (user stopwatch, n=1, mandala unspec, measured_at=2026-04-22 morning) | 미재측정 | 미재측정 |
| M3 (first card) | 대기 지속 | **60151ms** (prod telemetry, mandala_id=b079177d, measured_at=2026-04-22T12:33:35Z) | **3078ms** (same mandala post-rollback, measured_at=2026-04-22T13:54:56Z, n=1 pre/post pair) / **median 3626ms** (n=3, mandala_id=b079177d/58fb26fe/cfa8a4bf, measured_at=2026-04-22T13:54:56~16:47:43Z) | 미재측정 (PR #466 deploy 후 신규 runs 없음, next measurement ≤ CP420) |
| M4 (24 cards) | 미도달 | **최대 19** (user report, "2 cards 현상" 복수 사례 있음) | mandala_id=b079177d: 6 cards (recs=6, measured_at=2026-04-22T13:54Z) / mandala_id=58fb26fe: 14 cards / mandala_id=cfa8a4bf: null — **단일 mandala 분산 크고, 목표 24 미도달** | 미재측정 |
| M5 (action fill) | 부분 | 간헐 실패 (LoRA silent fail, 측정 방법 부재) | 미변화 | 미변화 |
| M6 (pool size per mandala = recommendation_cache rows) | 2~19 (user report) | 2~19 (user report) | mandala 별 분산: b079177d=15 / (다른 mandala) 6/14/null — **집계 median n=3 산출 부적합 (분산 너무 큼)** | 미재측정 |
| M7 (tx_levels_createMany) | n/a | **6.9s** (prod log, PR #449 직후, n 미상) | **4726ms** (prod telemetry, mandala_id=b079177d, measured_at=2026-04-22 CP418, post Lever A+ DROP) — Lever A+ 단독 < 1s 목표 미달, **~4s 잔존 (Lever A++ 후보 `trg_structural_edges_level` 의심)** | 미재측정 |
| M8 (Tier 1 drop rate, lexical) | ~73% (sample size 미상) | (Phase 3 semantic 전까지 유지) | Phase 3 semantic rollback → lexical subword 복귀, 현 drop rate 재측정 필요 | 미재측정 |
| video_pool (global discovery cache, not per-mandala) | — | 1164 (measured_at=2026-04-23 CP419 SSH+psql) | 1164 (변화 없음) | **1164** — 이틀째 0 growth, 다음 batch-collector fresh-quota run = **2026-04-23T07:30Z (~14h 후)** per PR #464 |

**Target (서비스 가능 선)**: M1 ≤ 1s / M2 ≤ 4s / M3 즉시 / M4 수 초 / M5 64/64 / **M6 50+** (per-mandala, CP419 시점 분산 6/14/15/null 으로 50 이상인 mandala 없음) / M7 < 1s / video_pool ≥ 10,000.

---

## Experiment ledger (chronological)

> **열 약어**: PR = merged PR 번호 (없으면 commit hash). **Status**: ✅ landed+prod, 🔄 landed but reverted, ⏳ landed pending verification, ❌ reverted same-day, 📝 design-only.

### Layer 1 — Data acquisition (YouTube discovery)

| Date | PR | Change | Hypothesis | Expected | Actual | Status |
|------|----|----|-----------|----------|--------|--------|
| 2026-04-15 | #393 | v3 cache+realtime + batch-video-collector pipeline | 3-tier cache 로 YouTube API 비용/지연 절감 | pool 채움 가속 | pool 채움 유지, 지연 개선 미측정 | ✅ |
| 2026-04-16 | #397 | Tier 2 gates + wizard UX + C+ prompt | 품질 낮은 카드 배제 | 관련도↑ | 관련도 감정적 개선, M6 에는 영향 없음 | ✅ |
| 2026-04-16 | #398 | 추천은 mandala 자체로 라우팅, legacy pool 우회 | pool mismatch 제거 | dashboard empty 감소 | empty 감소 관측, M3 여전 slow | ✅ |
| 2026-04-17 | #401 | shorts threshold 60s → 180s (YouTube 2024 policy) | 쇼츠 배제 정확도 | 지속 유지 | 유지 | ✅ |
| 2026-04-17 | #410 | stage-level observability | Tier 1/2 drop rate 계측 가능 | drop rate 숫자화 | M8 ~73% drop 발견 (lexical) | ✅ |
| 2026-04-18 | #414 (revert 동반) | 1-char Hangul + focusTags bypass center gate | 한글 단음절 drop 제거 | Tier 1 drop ↓ | 부분 개선, 근본 해결 아님 | 🔄 |
| 2026-04-18 | 3e4d0c2 | MAX_QUERIES 12→20, TARGET_PER_CELL 8→12 | recall 확대 | M6 ↑ | M6 부분 상승, pool 다양성 한계 | ✅ |
| 2026-04-21 | #428 | YouTube search per-call timeout + Promise.allSettled | 단건 timeout 이 전체를 blocking 하는 현상 제거 | pool 채움 안정화 | 안정화 확인 | ✅ |
| 2026-04-21 | #432, #433 | center-gate subword mode | Korean composite-word drop 해소 | Tier 1 drop ↓ | 부분 개선 | ✅ |
| 2026-04-22 | #446 | Phase 3 semantic center gate + V3_MAX_QUERIES env | semantic cosine gate 로 Tier 1 recall 0.27 → 높임 | M8 drop ↓, M6 ↑ | prod runtime `printenv=semantic` 확인. **M6 19 (target 50+) 미달** — cell assign bottleneck (Layer 2) 이 지배적 | ✅ |
| 2026-04-22 | #447 | `.env` 에 `V3_CENTER_GATE_MODE=semantic` sed 주입 | prod 활성화 | semantic 동작 | **silent miss** — compose `environment:` override 무시 | 🔄 |
| 2026-04-22 | #448 | compose `environment:` 에 `V3_CENTER_GATE_MODE=semantic` 직접 수정 | 실제 runtime 반영 | semantic 실제 활성화 | `docker exec printenv` 로 실측 | ✅ |
| 2026-04-22 | (CP416 revert) #454→#455 | V3_MAX_QUERIES=5, V3_TARGET_PER_CELL=3 세팅 | dashboard first-viewport 24 로 정렬 | pool 작아짐 | **"2 cards 현상" 악화** — 사용자 "수집 pool 자르지 말고 유지" | ❌ |
| 2026-04-22 | (non-git ops, CP418) | `docker-compose.prod.yml` `V3_CENTER_GATE_MODE` semantic → subword 수동 sed + `docker compose up -d api` | ~56s blocking embed 제거 (Phase 3 semantic 우회) | Tier 1 drop rate 는 lexical subword 기준으로 회귀 | `semanticGateEmbedMs=0` 확인 (mandala_id=b079177d pre/post: 56661ms → 0, measured_at=2026-04-22T12:33:35 vs 13:54:56Z, n=1). **sed 실행 2회** (EC2 `/var/log/auth.log` 실측): **1st 2026-04-22T13:52:19Z** (CP418 initial rollback), **2nd 2026-04-22T16:03:14Z** (PR #465 deploy 에 의해 overwrite 된 뒤 재-apply) — 이 재실행 사실이 PR #466 (repo pin) 도입의 필연성 근거. **caveat: "semantic 병목 해결" 이 아니라 "semantic 경로 차단 + lexical fallback"**. 재활성 조건: pool ≥10k + candidate top-N cap + domain-tuned embed | 🔄 rolled back |
| 2026-04-22 | #463 (`05c8eb9`) | Tier 2 quality gate (`quality-gate.ts` pure filter, 9 tests + executor 주입 + 3 env) | 저질 카드 (view<1000 or views/day<10) drop 가능 inventory | 1주일 `debug.droppedQuality` 분포 수집 후 flag flip A/B 판단 | landed **flag-off** (`V3_ENABLE_QUALITY_GATE=false` default). flag flip 없이 baseline window 진행 중 (n/a — no post-flip data yet) | ✅ landed, flag-off |
| 2026-04-22 | #464 (`d27b1c6`) | `.github/workflows/batch-video-collector.yml` cron `0 4 * * *` → `30 7 * * *` | YouTube quota reset (00:00 PT = **07:00 UTC PDT**) 직후 30min buffer 로 실행 → fresh 10k 전량 사용 가능 | `videos_new ≥ 500 per day` (schedule flip 단독 판정 기준) | **관측 대기** — 다음 run `2026-04-23T07:30Z` (report 작성 시점 2026-04-22T17:16Z 에서 ~14h 후). caveat: cron 은 UTC 고정, **PST 복귀 (2026-11-01, First Sunday of November) 후 07:30 UTC = reset - 30min (PST=08:00 UTC reset)** → DST follow-up 필요 | ✅ landed, 관측 대기 |
| 2026-04-22 | #465 (`52c49ea`) | 3 design doc (precompute + realtime-search + quality-gate) + 2 report update (perf-log + flow-anatomy) | SLO framework + Option C lock | docs-only | +1178 lines | ✅ docs-only |
| 2026-04-22 | #466 (`b47ba4f`, mergedAt 2026-04-22T16:26:16Z) | `docker-compose.prod.yml:39` `V3_CENTER_GATE_MODE=subword` pin + CP418 context comment + 재활성 조건 encode | CP418 prod manual subword edit 을 repo 에 동기화 — 다음 deploy 의 `Copy docker-compose.prod.yml to EC2` step 이 repo `semantic` 을 prod manual `subword` 위로 overwrite 하는 silent regression 차단 | prod runtime 계속 subword 유지 | Deploy `24789923782` **startedAt 2026-04-22T16:26:19Z / updatedAt 2026-04-22T16:37:37Z** SUCCESS. `/opt/tubearchive/docker-compose.prod.yml` `stat modify 2026-04-22T16:36:37Z` = repo pin 이 working copy 에 도달한 시각 (EC2 fs 실측). `docker exec insighta-api printenv V3_CENTER_GATE_MODE=subword` 실측 (uptime 74s). regression 사이클 1회 = 36~56s semanticGateEmbedMs 재도입 → PR #466 으로 제거 | ✅ landed, prod verified |

### Layer 2 — Scoring / gating (cell assignment + relevance)

| Date | PR | Change | Hypothesis | Expected | Actual | Status |
|------|----|----|-----------|----------|--------|--------|
| 2026-04-19 | 7c82a04 | recency + 3yr publishedAfter 기본 활성화 | 최신성 우대 | 관련도 유지 + 신선함 | 부작용 없음 | ✅ |
| 2026-04-19 | 352ad1f | `video_chunk_embeddings` 테이블 (semantic rating) | pgvector 기반 rerank 기반 마련 | 0 row 운영 | infra only | ✅ |
| 2026-04-20 | #423 | semantic rerank consumer module (flag off) | 점진 rollout | flag off = no-op | flag off | ✅ |
| 2026-04-20 | #424 | CP407 Phase B semantic rerank dev-probe | PASS 보고 | PASS | PASS (187 chunks) | ✅ |
| 2026-04-22 | (design) | `docs/design/v3-semantic-cell-gate.md` iter 1+2 | cosine cell assign + top-2 fallback + focus_tags bypass + gate-relative normalization | M9 drop 44→~12, M6 19→50+ | 미구현 (CP417 Primary) | 📝 |

### Layer 3 — Action fill (LoRA / Haiku)

| Date | PR | Change | Hypothesis | Expected | Actual | Status |
|------|----|----|-----------|----------|--------|--------|
| 2026-04-22 | #442 | prod OpenRouter embedding provider 활성화 | service critical path 에서 mac mini 제거 | 안정성↑ | 안정성 확인 | ✅ |
| 2026-04-22 | #440 | OpenRouter embed provider switch (Phase 1) | 동일 | embed latency 개선 | 개선 | ✅ |
| 2026-04-22 | #445 | wizard allow empty actions + post-creation fill | 빈 actions 에서도 저장 허용, 뒤에서 채움 | wizard 저장 가속 | 저장은 빨라졌지만 fill 경로 silent fail 존재 | ✅ |
| 2026-04-22 | #449 | 항상 depth=1 scaffold + legacy recovery | orphan mandala (level_2 → channels) 복구 | 8 scaffold rows | 적용 확인 (orphan 70ef45d9 → 8 rows) | ✅ |
| 2026-04-22 | #450 | action-fill primary: Haiku → mac mini LoRA (Haiku fallback) | 비용 해결 + 학습 데이터 축적 | primary LoRA | LoRA primary 동작 | ✅ |
| 2026-04-22 | #451 | compose env 에 `MANDALA_GEN_MODEL` 추가 | LoRA 호출이 실제 prod 에서 읽히도록 | LoRA 활성 | silent Haiku fallback 원인 해결 | ✅ |
| 2026-04-22 | #452 | LoRA NUM_PREDICT 2500 → 5000 | Korean mandala truncation (`done_reason: length`) 해결 | 완결 JSON | 완결 확인 (orphan refill cells 6/8) | ✅ |
| 2026-04-22 | #453 | LoRA-only action fill policy + failure log + retry CLI | 실패 재학습 데이터 보존 | 사용자 directive 반영 | landed | ✅ |
| TBD | — | LoRA direct-call JSON parse error root cause | `generation_log` valid/invalid diff 로 format drift 규명 | slot 2개 (positions 6-7) 채움 | 미착수 (CP417 Secondary) | 📝 |

### Layer 4 — DB write (wizard save)

| Date | PR | Change | Hypothesis | Expected | Actual | Status |
|------|----|----|-----------|----------|--------|--------|
| 2026-04-17 | #402 | Prisma `connection_limit` override at client construction | 접속풀 고갈 방지 | 안정성 | 안정성 | ✅ |
| 2026-04-17 | #403 | default sort relevance + parallelize post-creation + timing log | 정렬 기본값 + 병렬 | M1/M2 개선 | **prod 런타임 실패** (tsc pass + jest pass, 브라우저 실패) | ❌ (`b134812` 즉시 revert) |
| 2026-04-17 | #404 | 대시보드 즉시 네비게이트 (서버 대기 안 함) | M3 즉시 | **prod 런타임 실패** (CI green, 브라우저 실패) | ❌ (`15011d5` 즉시 revert) |
| 2026-04-18 | f0f0025 | 자동 pgbouncer=true for :6543 transaction pooler | 잘못된 pooler URL 패턴 방지 | 안정성 | 안정성 | ✅ |
| 2026-04-18 | #413 + 2d2a770 | wizard optimistic UI + AUTO_ADD_PER_CELL cap 제거 | M1 즉시 + auto-add throughput | M1 개선 | **CP389 revert** (557900d) — 같은 이유 | ❌ |
| 2026-04-22 | #456 | **Lever A**: `trg_goal_edge` / `trg_topic_edges` drop + `syncOntologyEdges` 앱레이어 fire-and-forget | edge trigger cascade per-row 210 queries → tx 에서 제거 | M7 5.1s → ~2s | Lever A 단독으로는 ~5.1s 잔존 (node 트리거 남음) | ✅ |
| 2026-04-22 | #462 (mergedAt 2026-04-22T12:13:57Z) | **Lever A+**: `trg_sync_goal` / `trg_sync_topics` drop + node upsert 앱레이어화 | 117 queries → 18 queries | M7 < 1s | **M7 = 4726ms** (prod telemetry, mandala_id=b079177d, measured_at=2026-04-22 CP418, **n=1 단일 샘플 — 후속 수집 필요**). 목표 < 1s **미달** — ~4s 잔존. 원인 의심: `trg_structural_edges_level` (mig 005) 가 `user_mandala_levels` INSERT path 에 남아 있음. Lever A++ 후보로 read-only investigation 예정 | ⏳ partial (DROP TRIGGER 완료, target 미달) |

### Layer 5 — Delivery (dashboard stream / sort)

| Date | PR | Change | Hypothesis | Expected | Actual | Status |
|------|----|----|-----------|----------|--------|--------|
| 2026-04-21 | #430 | in-process SSE card stream endpoint (Phase 1 slice 2) | push 기반 전환 | M3 즉시 | endpoint ready, 소비자 없음 | ✅ |
| 2026-04-21 | #431 | SSE-stream consumer hook + merge into RecommendationFeed | FE 측 소비 | M3 즉시 | 처음 연결 시 **백로그 emit 안 함** — 이후 Phase B 에서 수정 | ✅ (미흡) |
| 2026-04-21 | #434 | POST /wizard-stream parallel SSE endpoint (P0) | wizard 저장 자체를 스트리밍화 | M1/M2 체감 ↑ | **설계 redesign** (CP415) 필요 — 미적용 상태 | ✅ (미활용) |
| 2026-04-21 | #435, #436, #437 | wizard-stream save skill + hook + 플래그 mount | 사용자 전환 | flag off 유지 | flag off (미활성) | ✅ |
| 2026-04-21 | #438 | `cardPublisher` notify on `user_video_states` upsert | auto-add → SSE notify | push 전파 | push 전파 확인 | ✅ |
| 2026-04-21 | #439 | IndexPage subscribe useVideoStream + invalidate | FE query invalidation | live 업데이트 | live 확인 | ✅ |
| 2026-04-22 | #443 | streaming-view flag default off (hotfix) | PR #444 prod 사고 롤백 | 안정성 | 안정성 | ✅ |
| 2026-04-22 | #444 | wizard streaming preview (Phase 1) | 생성 과정 프리뷰 | M2 체감 ↑ | CP416 에서 flag 관리 | ✅ |
| 2026-04-22 | #457 | **Phase A**: `/recommendations` orderBy `[rec_score desc, cell_index asc]` + stream | 관련도 순 전달 | 첫 카드 = 점수 최고 | landed, prod | ✅ |
| 2026-04-22 | #459 | **Phase B**: SSE endpoint backlog emit on connect + FE merge 전역 재정렬 | 대시보드 오픈 즉시 기존 row 스트리밍 | M3 즉시 | landed, prod, health 200 | ✅ |

### Layer 6 — UX (default, refresh)

| Date | PR | Change | Hypothesis | Expected | Actual | Status |
|------|----|----|-----------|----------|--------|--------|
| 2026-04-15 | #389 (postponed→#425) | Newly Synced tab | sync 결과 즉시 확인 | UX 정합성 | #425 로 landed | ✅ |
| 2026-04-22 | #441 | PWA autoUpdate + `/api/*` cache drop | stale cache 로 인한 "새 카드 미반영" 방지 | 실시간성↑ | landed | ✅ |
| 2026-04-22 | #460 | **Phase C**: atomic set-default for new mandala | wizard 생성 직후 대시보드 default 전환 | "영어면접 default 의 5 카드" 버그 제거 | landed, prod | ✅ |
| TBD | — | `docs/design/card-refresh-strategy.md` (4-layer: Coverage + MMR + Exploration + Feedback bias) | 카드 refresh 정책 | M6 다양성 + 새로고침 가치 | 설계만, 미구현 | 📝 |
| TBD | — | `docs/design/progressive-relevance-stream.md` | stream 내 점수 정렬 알고리즘 | 첫 카드 = best | 설계만, 미구현 | 📝 |

---

## Reverted experiments (주의 — 재시도 전 이전 실패 원인 확인)

| Date | PR | 반전 사유 | 재시도 조건 |
|------|----|----------|-------------|
| 2026-04-17 | #403 | prod 런타임 실패 (tsc/jest pass + 브라우저 실패) | `/verify` browser smoke 통과 필수 (CLAUDE.md Hard Rule) |
| 2026-04-17 | #404 | 동일 | 동일 |
| 2026-04-18 | #413 + 2d2a770 | CP389 retrospective — optimistic UI 가 실제 저장 실패를 숨김 | 서버 응답 확정 후 상태 전환하는 패턴으로만 |
| 2026-04-22 | #454 | "2 cards 현상" 악화 — pool 축소가 사용자 가치 파괴 | pool 축소는 금지. 필요 시 display cap 만 (refresh diversification 전제) |
| 2026-04-22 | (no PR — **uncommitted discard**) | Option C scaffold (`prisma/migrations/wizard-precompute/001_status_column.sql` + `prisma/schema.prisma` `user_mandalas.status` 컬럼 추가) | **Scaffold 는 `user_mandalas.status` 확장 접근** — design doc SSOT (`docs/design/precompute-pipeline.md`, 별도 테이블 `mandala_wizard_precompute` + `session_id` PK + pg_cron TTL) 와 구조적 불일치. `src/skills/plugins/video-discover/v3/executor.ts:118` mandala_id hard-dep 은 **양 접근 공통**. 36 query site 전수 `WHERE status != 'draft'` 패치는 **scaffold 접근에서만 필요** (SSOT 접근은 별도 테이블이라 user_mandalas read path 0 touch). **Revert 방식: commit 없이 working-tree edit discard + untracked file 삭제 (branch `feat/cp417-wizard-precompute-draft` 는 main 과 동일 HEAD `bd2651b`, 커밋 0개).** 재참조 불가 — 재구현 시 design doc SSOT 기반 from-scratch | **SSOT 확정 = `docs/design/precompute-pipeline.md` (별도 테이블 `mandala_wizard_precompute`).** 재구현 전제 (재정의): (1) `src/skills/plugins/video-discover/v3/executor.ts:118` mandala_id-optional 경로 신설 (양 접근 공통), (2) `mandala_wizard_precompute` 테이블 migration + pg_cron TTL sweep (SSOT), (3) `/wizard-stream` + `/create-with-data` handler 수정 (session_id passing). **비용: 미산정** — scaffold 기준 2-3h 예상치는 `user_mandalas.status` 접근 기반이라 무효. SSOT 기반 재산정 필요 |

---

## Current state (2026-04-23 end of CP419)

**Prod live (실측 근거 포함)**:
- **`V3_CENTER_GATE_MODE=subword`** (PR #466 pin, measured_at=2026-04-23 CP419, `printenv` 실측). Phase 3 semantic center gate 는 rollback 상태 — 재활성 조건 pool ≥10k + candidate top-N cap + domain-tuned embed 전까지 보류.
- Phase A relevance-first sort (#457) — landed
- Phase B SSE backlog (#459) — landed
- Phase C atomic default mandala (#460) — landed
- Lever A edge trigger defer (#456) — prod DROP TRIGGER 완료
- Lever A+ node trigger defer (#462) — prod DROP 완료 (pg_trigger 4→2, verified CP418). **M7 = 4726ms (n=1, mandala_id=b079177d)** — 목표 < 1s 미달, Lever A++ 후보 carryover.
- Tier 2 quality gate (#463) — **flag-OFF** (`V3_ENABLE_QUALITY_GATE=false`), A/B baseline window 진행 중
- batch-video-collector cron = **07:30 UTC** (#464) — 다음 첫 fresh-quota run 2026-04-23T07:30Z, **미관측**. DST 주의: PST 복귀 후 pre-reset 30min 으로 전환.
- Action-fill LoRA primary (#450~#453), LoRA NUM_PREDICT 5000 (#452) — landed

**No deploy in flight** — CP419 시점 모든 open PR 머지 완료.

**실측된 지점 (n 주석 포함)**:
- **M3 pair 비교**: mandala_id=b079177d, pre=60151ms (semantic live, 2026-04-22T12:33:35Z) / post=3078ms (subword rollback, 2026-04-22T13:54:56Z) — **n=1 pre/post pair, 단일 mandala**. Aggregate "60s → 3.1s / 19× 단축" 표현 지양.
- **M3 post-rollback 소표본 median**: 3626ms (n=3, mandala_id=b079177d/58fb26fe/cfa8a4bf, measured_at=2026-04-22T13:54:56~16:47:43Z). p95 산출 불가 (샘플 부족).
- **M4 분산 큼**: same 3 mandala 에서 recs=6/14/null. 단일 mandala 별로 봐야 의미 있음 — 집계 median 부적합.
- **M6 분산 큼**: 동일 범위 6/14/15/null — 목표 50+ 기준 전 mandala 미도달.
- **M7 = 4726ms, n=1** (mandala_id=b079177d, post Lever A+ DROP).
- **video_pool = 1164** (global, measured_at=2026-04-23 CP419 `ssh insighta-ec2 + psql DIRECT_URL`), growth 최근 2일간 0.

**미측정 / pending**:
- M1/M2 post-Lever A+ 재측정 (CP417 `6s/3s` user stopwatch 이후 신규 데이터 없음)
- M3 post PR #466 재측정 (PR #466 deploy=2026-04-23 이후 신규 mandala pipeline run 이 DB 에 없음)
- Tier 2 quality gate flag-on A/B (1주일 baseline window)
- batch-collector fresh-quota first run

---

## Outstanding hypotheses (CP417+)

| # | Hypothesis | Layer | Expected lever | Design status |
|---|------------|-------|----------------|---------------|
| H1 | Gate 2 semantic cell assignment 으로 M6 19→50+ | L2 | `docs/design/v3-semantic-cell-gate.md` iter 2 | ready, option (a)/(b)/(c) 결정 대기 |
| H2 | LoRA direct-call JSON parse error 해소로 M5 62/64 → 64/64 | L3 | `generation_log` valid/invalid diff | 착수 전 |
| H3 | DB INSERT 추가 튜닝 — Lever A++ 후보 `trg_structural_edges_level` (mig 005) DROP 검토 | L4 | M7 = 4726ms (n=1, mandala_id=b079177d) 중 ~4s 잔존분을 설명하는 유일 trigger 후보. pg_trigger before=4/after=2 (post Lever A+), 잔존 2개 중 하나 | CP420 read-only investigation 예정 — DROP 판단 났을 때 mig 013 SQL + 별도 승인 세션 |
| H4 | Card refresh 4-layer (Coverage + MMR + Exploration + Feedback) | L6 | `docs/design/card-refresh-strategy.md` | 설계 있음, 구현 전 |
| H5 | Progressive relevance stream | L5 | `docs/design/progressive-relevance-stream.md` | 설계 있음, 구현 전 |
| H6 | V3_ENABLE_SEMANTIC_RERANK=true activation | L2 | 187 chunks already in pgvector | flag off 대기 |
| H7 | deploy.yml 에 `prisma/migrations/ontology/*.sql` 러너 추가 | 인프라 | Lever A/A+ post-deploy 수동 DROP 필요 없도록 | 설계 미작성 |

---

## Update protocol (이 파일의 유지관리)

1. **PR merge 직후**: 해당 Layer 표에 새 row 추가. Status = ✅ landed pending verification (⏳ 사용 가능).
2. **Deploy + 실측 후**: Actual 열을 실제 숫자로 교체. Status → ✅.
3. **Revert 시**: 원 row 의 Status 를 ❌ 로 변경하고 "Reverted experiments" 섹션에 추가. 재시도 조건 명시.
4. **새 hypothesis 착수 시**: "Outstanding hypotheses" 에서 제거하고 해당 Layer 표에 새 row 로 이동 (Status 📝 → ⏳).
5. **Baseline 재측정 시**: Baselines 섹션의 "최신 확인" 열 추가/갱신 (옛 값 보존).
6. **갱신 주기**: 최소 CP 단위. 실험 한 단위 완료 시 바로 반영 권장.

---

## Notation discipline (기존 row 의 drift)

이 문서의 Block A (CP419, 2026-04-23) 이전 row 들 중 date 컬럼이 KST 기준으로 기록된 row 가 10건 식별됨 — line 60, 80, 82, 83, 90, 91, 104, 105, 122, 132. 당시 암묵적 관행이 KST merge date 기록이었고, Block A 에서 UTC 규약이 명시됐다.

Unverifiable 1 row: line 84 (design doc iter row, no PR/commit).

Date 컬럼은 일반적으로 merge date (UTC) 를 의미. 예외: line 131 은 proposal date (원 제안 시점 참조, 해당 row caveat 참조).

기존 drift row retrofit 은 별도 작업으로 분리 (미commit). 일부 drift 는 incident analysis / baseline 해석에 영향 가능. 신규 row 는 `measured_at=UTC` 및 date 컬럼 UTC 기준 규약 적용.

---

## Cross-references

- Design docs: `docs/design/wizard-dashboard-redesign-2026-04-21.md`, `docs/design/wizard-service-redesign-2026-04-22.md`, `docs/design/v3-semantic-center-gate.md`, `docs/design/v3-semantic-cell-gate.md`, `docs/design/card-refresh-strategy.md`, `docs/design/progressive-relevance-stream.md`
- Related migrations: `prisma/migrations/ontology/011_drop_goal_topic_edge_triggers.sql` (Lever A), `prisma/migrations/ontology/012_drop_goal_topic_node_triggers.sql` (Lever A+)
- Memory: `~/.claude/projects/-Users-jeonhokim-cursor-insighta/memory/checkpoint.md` (CP388~CP416), `work-efficiency.md`, `architecture.md`, `troubleshooting.md`
