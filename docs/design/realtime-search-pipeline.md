# Design — Realtime Search Pipeline (Phase 3A, SLO-2 latency + quality)

**Date**: 2026-04-22
**Owner**: CP417+
**Status**: DRAFT (Phase 3B 완료 후 활성화)

---

## 핵심 목표 (1줄)

pool 규모 도달 이후 실시간 검색 경로를 **≤12s + 50~80 cards** 로 복귀 (SLO-2).

## 본질 (1줄)

request-time **O(N_videos)** embed 를 사전 계산된 **O(1) KNN** 으로 교체 — #446 이 놓친 구조적 해결.

## 컨셉 (1줄)

**Tier 1 pgvector KNN 재활성 + semantic gate v2** — candidates top-N cap + center_goal embedding 1회만. O(수백) embed → O(1) 로 구조 전환.

---

## 선행 조건 (엄격)

이 설계는 **Phase 3B readiness gate 3개 모두 충족 후** 에만 구현 착수.

1. `SELECT COUNT(*) FROM video_pool` ≥ **10,000**
2. KNN top-60 precision ≥ 50% (샘플 mandala 10건 수동 QA)
3. embedding 누락률 < 5%

**충족 안 되면**: PR #398 prod incident 재현 위험 (cosine 0.3-0.5 in small pool → unrelated matches). 이 design 은 **미완결 상태로 유지** — Phase 3B 가 끝나기 전까지 구현 절대 금지.

---

## 설계

### 호출 경로 (변경 후)

```
v3 executor.execute(ctx):
  t0 = now
  
  # 1. center embedding (1회)
  centerEmbedding = await embedBatch([centerGoal])[0]   # ~100ms OpenRouter
  
  # 2. Tier 1 KNN (pgvector)
  tier1 = await matchFromVideoPoolV2({
    centerEmbedding,             # NEW: 기존 sub_goal 기반 KNN 대신 center 기반
    language,
    topN: V3_TIER1_KNN_LIMIT,    # default 540 (9 cells × 60 buffer)
    cosineThreshold: V3_SEMANTIC_THRESHOLD   # default 0.45
  })                             # ~100-300ms (1 SQL query)
  
  # 3. mandala filter (PR #398 로직 공유)
  filtered = applyMandalaFilter(tier1, { centerGoal, subGoals, language, focusTags })
  # Gate 1 + Gate 2, cell assignment. 기존 코드 그대로.
  
  # 4. deficit 이 있을 때만 Tier 2 realtime
  deficitCells = cells where have < V3_TARGET_PER_CELL
  if deficitCells.length > 0:
    tier2 = await runTier2({ deficitCells, ... })   # 기존 경로
  
  # 5. 최종 per-cell top-N + upsert
```

### 신규 쿼리 (`matchFromVideoPoolV2`)

```sql
-- center_goal embedding 기준 KNN
SELECT vp.video_id, vp.title, vp.description, vp.channel_name, vp.channel_id,
       vp.view_count, vp.like_count, vp.duration_seconds, vp.published_at,
       vp.thumbnail_url, vp.quality_tier,
       1 - (vpe.embedding <=> $center_emb::vector) AS similarity
  FROM public.video_pool vp
  JOIN public.video_pool_embeddings vpe ON vpe.video_id = vp.video_id
 WHERE vp.language = $language
   AND vp.is_active = true
   AND vp.expires_at > NOW()
   AND (vpe.embedding <=> $center_emb::vector) < (1 - $cosine_threshold)
 ORDER BY vpe.embedding <=> $center_emb::vector
 LIMIT $top_n;
```

index:
```sql
-- 이미 있음 (video_pool_embeddings.embedding 에 ivfflat/hnsw index 전제)
-- 없으면 follow-up: CREATE INDEX ... USING hnsw (embedding vector_cosine_ops);
```

### Env / flag

| env | default | 의미 |
|---|---|---|
| `V3_ENABLE_TIER1_CACHE` | `false` | Phase 3B readiness gate 통과 후 `true` 로 flip |
| `V3_SEMANTIC_THRESHOLD` | `0.45` | cosine 하한 (PR #398 은 0.3 사용 + incident, 0.5 로 bandaid 검토했지만 mandala-filter 병행 전제 0.45 예비) |
| `V3_TIER1_KNN_LIMIT` | `540` | KNN 결과 상한 (9 cells × 60 buffer) |

### Shadow mode (활성 전 의무)

`V3_ENABLE_TIER1_CACHE=true` flip 전, **shadow 1주일**:
- Tier 1 결과를 실행하되 실제 recommendation_cache upsert 는 Tier 2 경로만 사용
- Tier 1 결과는 `mandala_pipeline_runs.step2_result.debug.tier1_shadow` 에 기록
- 1주일 후 비교:
  - Tier 1 상위 N 이 Tier 2 선택과 얼마나 겹치는가 (precision)
  - Tier 1 이 새로 제시한 카드의 mandala-filter 통과율 (recall)
- 통과 기준: precision ≥ 50%, mandala-filter 통과율 ≥ 60%

### semantic gate v2 (realtime 경로 내)

Tier 2 realtime 의 기존 `semanticGateEmbedMs` (56s 병목) **제거**:
- request-time embed 제거
- Tier 2 candidates 를 받자마자 **mandala-filter.ts 의 Gate 1 (substring) 만** 통과 필터
- Tier 2 에서 새로 들어온 영상을 다시 embed 하려면 Phase 3B 의 embedding worker 가 처리 (비동기)
- 결과: Tier 2 latency 3s 그대로 유지, semantic 은 Tier 1 이 담당

---

## Risk / Rollback

| Risk | 완화 |
|------|------|
| Phase 3B 미완 상태에서 Tier 1 재활성 → PR #398 incident 재현 | readiness gate 3개 엄격 준수. shadow 1주일 결과 승인 전 flip 금지 |
| pgvector KNN 성능 저하 (index 없음) | HNSW index 생성 migration 선행 (`CREATE INDEX ... USING hnsw`) |
| center embedding 1회 호출도 OpenRouter down 시 blocking | fallback 경로: OpenRouter 실패 → Tier 1 스킵 → Tier 2 only (기존 동작) |
| cosine threshold mis-tune | shadow mode 결과로 threshold 결정. tuning 값은 env 로 외부화 |

**Rollback**: `V3_ENABLE_TIER1_CACHE=false` 1-line env flip. code revert 불필요.

---

## 측정 / SLO 검증

- `step2_result.metrics.duration_ms` p50/p95/p99 (by `trigger` column)
- `step2_result.total_recommendations` — pool 축 SLO (≥40)
- `step2_result.debug.tier1_shadow` (shadow mode 기간 동안만)
- `recommendation_cache` 분포 (quality tier / view count / cell coverage)
- p95 기준 12s 통과 여부 (SLO-2 confirm)

---

## Non-goals

- Domain-tuned embedding model (PR #398 follow-up Step 5 의 본래 조건) — 본 PR 에서 qwen3-8b 로 시작, 결과 나쁠 시 별도 track 으로 이전
- Redis caching of center embedding — 같은 mandala 재실행은 이미 mandala_embeddings 테이블 있음, 추가 layer 불필요
- Tier 1 cache 결과를 다른 소비자 (batch auto-add 등) 로 공유 — 현 consumer 만 대상
