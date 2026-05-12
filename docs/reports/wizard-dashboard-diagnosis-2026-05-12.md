# Wizard → Dashboard 진단 보고 — 2026-05-12 세션

**Purpose**: 2026-05-12 단일 세션에서 진행한 위저드 → 대시보드 arc 의 전수 진단 결과 누적. 코드 + log + DB + ledger 3-축 교차 검증 데이터만 수록. 추측 X.

**Scope**:
- 위저드 응답 속도 (M7 / tx_total)
- 카드 품질 (rec_score top picks)
- 카드 수량 (per-cell rec_count + drop stages)
- 버려진 카드의 운명 (video_pool 정책)
- Rich Summary trigger timing
- 벡터 / 그래프 데이터 인벤토리
- Shorts cutoff

**기준 mandala (trace 대상)**: `7b99f68c-93d7-4851-83aa-99f4ef418f20` "한달 안에 영어로 의사 표현하기" (2026-05-12T08:44:41Z 생성)

---

## 1. 위저드 응답 속도 — Pool exhaustion → Fix shipped

### 진단 데이터 (`mandala_create_timings` n=49, 2026-04-23 ~ 2026-05-11)

| 측정 | p50 | p95 | max |
|------|-----|-----|-----|
| `tx_mandala_create` | 101ms | 301ms | 397ms |
| `tx_levels_createMany` | 98ms | 2489ms | 5027ms |
| `tx_find_unique` | 17ms | 39ms | 157ms |
| 측정 내부 합 | ~216ms | ~2.8s | — |
| **`tx_total`** | **3867ms** | 7980ms | 9233ms |
| **미발견 gap** | **~3.65s** | ~5.2s | ~4.2s |

### 갭의 정체 — Bimodal

```
min  10ms · p10  524ms · p50 3677ms · p90 4862ms · max 8283ms
under_500ms: 5  ·  500-2000: 7  ·  over_2000ms: 37
```

동일 user 60초 간격에 gap 12배 변동 (4185ms → 329ms). 코드 동일 → **외부 contention**.

### Root cause (3-축 일치)

| 축 | 증거 |
|----|------|
| Code | `connection-url.ts:21` `DEFAULT_POOL_LIMIT = 5`. `PRISMA_POOL_LIMIT` env 미설정 → 5 적용 |
| Log | `[prisma-init] {"pool_limit":5,"host":"aws-0-us-west-2.pooler.supabase.com:6543"}` |
| Log | `[prisma-slow-query]` 의 `UPDATE youtube_videos SET transcript_fetched_at` 3110~5295ms × 10건 연속 — pool slot 점유 |
| DB | 동일 user 12× variance, gap 분포 bimodal |

→ Supabase **transaction pooler (port 6543)** + Prisma `pool_limit=5` + background hot path 가 슬롯 점유 → wizard `$transaction` 진입 시 connection acquire 대기 3-7s.

### Fix — PR #609 (commit `e1fa6c71`, deployed 2026-05-12T08:40Z)

```yaml
# docker-compose.prod.yml (api service env)
- PRISMA_POOL_LIMIT=15
```

Deploy 검증:
- `[prisma-init] {"pool_limit":15, ...}` (post-deploy 49s uptime)
- `[prisma-slow-query]` 첫 2분간 0건 (직전 10건 연속 → 0)

검증 측정 대기: n=20 trickle 후 `/mandala-perf γ`. 예상 gap p50 3677ms → < 500ms.

### 부수 발견 — `transcript_fetched_at` UPDATE 도 같은 근본 원인

`[prisma-slow-query]` 의 4404ms duration 은 Prisma 측정값 = **connection acquire + 실제 SQL**. 실제 SQL <100ms 로 추정. Pool=15 적용 후 자동으로 빨라질 가능성 높음 → **Fix #2 (transcript batch 화) 는 보류**, deploy 후 측정으로 결정.

### 롤백 매트릭스

1. SSH sed (~2분): `bash scripts/ssh-connect.sh "cd /opt/tubearchive && sed -i '/PRISMA_POOL_LIMIT/d' docker-compose.prod.yml && docker compose up -d api"`
2. `git revert <e1fa6c71>` → CI/CD redeploy (~5-10분)
3. 즉시 unset 불가 (env는 컨테이너 재기동 필요)

---

## 2. 카드 품질 — 의료영어 oversaturation (Issue #610)

### 증상

mandala 7b99f68c (영어 학습) cell 0 의 top rec_score 1.0 카드 = **"기초문진에 필요한 영어, 쉽게 말하기 part 1 [의료영어회화 002]"**. 그 외 cell 0 카드:
- "[병원영어] 아플때 병원가서 쓰는 필수 영어표현" (rec_score 0.95)
- "혹시 임신 가능성이 있으신가요?+ ... [의료영어회화 007]" (rec_score 0.94)
- "영어의사 알렉스" 채널 × 3건
- ~50% 의료영어 채널 점유

### 진단 (3-축)

| 축 | 증거 |
|----|------|
| LLM | sub_goals 정확함: "1분 스피치로 자신의 의견 표현하기" — LLM 이 "의사" → "의견" 올바르게 변환 |
| Git | PR #555 / commit `e4a48e46` (2026-05-04) 가 `V3_USE_YOUTUBE_RANKING_ONLY=true` 도입 → mandala-filter bypass |
| DB | `mandalaFilterInput: 135 → Output: 135 (drop 0)` — 필터 효과 0 |

→ YouTube 인기 ranking 그대로 신뢰 → "영어 의견 표현" 검색에서 의료영어회화 (인기 채널) 가 1위 점유.

### 왜 단일 flag flip 금지

- PR #555 도입 사유 = mandala-filter 자체 false-positive 해결 목적. revert 시 그 problem 재현.
- CP418 `V3_CENTER_GATE_MODE` oscillation 패턴 (semantic → subword → semantic → ...) 의 cell-level 재현 위험.
- **CLAUDE.md Active Rule F** ("Multi-layer PR 3 hotfix patch-on-patch stop") 적용 대상.

### 등록 위치 — Issue #610 (spec ticket)

해결 전제 (issue body 명시):
1. PR #555 의 도입 의도 / 원래 false-positive 케이스 확인
2. 5+ mandala (finance / health / hobby / education / career) cross-regime 비교
3. 세 옵션 중 결정:
   - (a) cell-level semantic filter + 튜닝된 threshold
   - (b) per-domain ranking strategy
   - (c) two-stage retrieval + cosine rerank top-N
4. 디자인 문서 cross-ref: `v3-semantic-center-gate.md`, `v3-semantic-cell-gate.md`, `progressive-relevance-stream.md`, `card-refresh-strategy.md`

---

## 3. 카드 수량 — 5/8 cells 만 채워짐

### 증상 (mandala 7b99f68c)

```
8 cells 중 :
  cell 0  →  rec 12,  user_video_states ~12
  cell 1  →  rec 0   ← 빈 셀
  cell 2  →  rec 9
  cell 3  →  rec 0   ← 빈 셀
  cell 4  →  rec 12
  cell 5  →  rec 4
  cell 6  →  rec 12
  cell 7  →  rec 0   ← 빈 셀
총: 49 cards (사용자 목표 "최소 40-50" 경계)
```

### Stage breakdown (mandala_pipeline_runs.step2_result.debug)

| 단계 | 값 | 해석 |
|------|-----|------|
| rule queries (cell-specific) | 거의 0 hit | cell 별 query "한달 안에 영어로 의사 표현하기 + sub_goal" → YouTube 매칭 X |
| LLM queries | 4건 hit (46+46+46+38), 1건 0 hit | LLM 이 cell-별 query 안 만들고 generic English 검색 |
| poolAfterDedupe | 290 | raw 합 |
| **droppedShortsDuration** | **137 drop** | duration ≤ 180s = drop |
| scoredCandidates | 135 | dedupe + filter 후 |
| droppedBlocklist | 18 | channel block |
| mandalaFilterInput → Output | 135 → 135 | **drop 0 (PR #555 bypass)** |
| perCellAssigned | 5 cells | 8 cells 중 3 cells (1/3/7) empty |

### 원인 3-layer (단일 fix 불가)

1. **Shorts cutoff 180s 가 영어 학습 도메인에 공격적** — 30초~3분 짧은 영상 많음
2. **LLM query gen 이 cell-별 query 안 만듦** — generic English query 만 생성 → cell 1/3/7 sub_goal text 가 query 풀에 미반영
3. **Cell 분배 알고리즘 편향** — 135 candidate 가 5 cells 에만 들어감

### 권장 (단편 fix 금지)

issue 등록 권장. 도메인별 shorts cutoff + cell-별 query gen 보장 + 분배 fairness 통합 spec.

---

## 4. 버려진 카드의 운명 — Video pool 미보관

### `video_pool` source 분포

| source | n |
|--------|---|
| `batch_trend` | 9,553 |
| `v2_promoted` | 1,200 |

→ **v3 discover search 가 drop 한 후보는 어디에도 저장 안 됨**.

### 정책 (현재)

```
batch-video-collector (cron, 매일 07:30 UTC, fresh quota 직후)
        ↓
   video_pool (10,753 rows)
        ↓
   v3 cache-matcher / search
        ↓
   recommendation_cache → user_video_states
        ↓
   drop된 후보 → 사라짐 (one-way, history 없음)
```

→ "drop 사유 + score 보존하는 candidate_history 테이블" 같은 spec 이 있어야 재사용 가능.

---

## 5. Rich Summary 발화 시점

### 두 경로

**A. 위저드 직후 auto (현재 활성)**:
```
wizard 완료 → mandala-post-creation (setImmediate)
            → pipeline-runner step 3 (maybeAutoAddRecommendations) 완료
            → setImmediate 으로 enqueueRichSummaryForMandalaCards (pipeline-runner.ts:251)
            → OpenRouter 호출 → video_rich_summaries 테이블
```
- Gate: `RICH_SUMMARY_ENABLED=true` (prod ON)
- Quota 게이트: free=30 / pro=200 / lifetime=admin=unlimited
- LLM 직렬 처리 (1 in-flight) — 모든 카드 즉시 X

**B. 일일 cron (현재 OFF)**:
- Env: `RICH_SUMMARY_V2_CRON_ENABLED=false` (prod startup log 확인)
- 의도: 17:00 UTC = 02:00 KST daily tick, batch 50개 v2 처리
- 현재 비활성, 경로 A만 작동

### 일반 vs 상세

같은 v2 layered prompt 의 single LLM call 로 **동시 생성**:
- `core` (일반) + `analysis` / `lora` / `segments` (상세)
- "일반 즉시 → 상세 나중" 흐름 아님

### Prod 누적

video_rich_summaries 79 rows (prod, 2026-05-12 시점). 자연 traffic 누적.

---

## 6. 벡터 데이터 인벤토리 (5 테이블)

| 테이블 | 차원 | rows | 저장 | 활용 | 상태 |
|--------|-----|------|------|------|------|
| `mandala_embeddings` | 4096 | 19,137 | 각 mandala sub_goal text (cell당 1 row) | v3 mandala-filter, `searchMandalasByGoal` (template floor 0.4), cache-matcher | 활성 |
| `video_pool_embeddings` | 4096 | 10,645 | video_pool 의 video title embedding | cache-matcher cosine 매칭 (rec_reason='cache') | 비활성 (PR #556 "noise > signal", 2026-05-06) |
| `video_chunk_embeddings` | 4096 | 2,641 | 비디오 transcript chunk embedding | semantic-rank.ts rerank | 비활성 (`V3_ENABLE_SEMANTIC_RERANK=false`) |
| `keyword_scores` | 4096 | 1,253 | trend keyword embedding + IKS score | iks-scorer Phase 2b goal_relevance | 활성 |
| `ontology.embeddings` | **768** | 26 | ontology 노드 title embedding (다른 모델) | ontology.search semantic | 실험적, 사실상 dead |

**모델**: 활성 4개 = qwen3-embedding:8b (4096d). `ontology.embeddings` 만 768d (별도 모델).

### 미진단 약점

- `video_pool_embeddings` 10,645 적재 비용 vs prod 비활성 (효용 0)
- `video_chunk_embeddings` 2,641 적재 비용 vs 비활성 (Phase 3A 대기 1년+)
- `ontology.embeddings` 26 rows = schema artifact

---

## 7. 그래프 데이터 인벤토리 (ontology schema)

### Tables

`nodes, edges, embeddings, action_log, action_types, object_types, relation_types`

### Nodes — 10 type, 총 ~177K rows

| Type | Count | 의미 |
|------|-------|------|
| `topic` | 103,304 | sub_goal 의 각 subject (셀당 8 항목) |
| `atom_node` | 15,014 | rich-summary v2 atom 단위 |
| `goal` | 13,466 | mandala center_goal |
| `mandala_sector` | 13,456 | mandala 의 8 cell (sector) |
| `concept` | 10,107 | rich-summary core 개념 |
| `section_node` | 9,936 | rich-summary section |
| `action_node` | 6,695 | 실행 가능 action |
| `resource` | 2,655 | 학습 리소스 |
| `mandala` | 1,501 | mandala 자체 |
| `video_resource` | 1,311 | video reference |

### Edges — 8 relation, 총 ~146K rows

| Relation | Count | 방향 |
|----------|-------|------|
| `CONTAINS` | 103,520 | mandala→sector / sector→topic (압도적, 위계) |
| `HAS_ATOM` | 15,014 | video → atom |
| `COVERS` | 10,937 | concept → topic |
| `HAS_SECTION` | 9,933 | video → section |
| `SUGGESTS` | 6,695 | → action |
| `RELEVANT_TO` | 106 | cross-mandala (실험) |
| `MENTIONS` | 9 | video → topic (거의 미작동) |
| `PLACED_IN` | **8** | **card → sector (CP415 trigger 거의 실패)** |

### 활용 경로

| 시점 | 코드 | 그래프 작업 |
|------|------|------------|
| wizard 저장 | `sync-edges.ts` | mandala / sector / goal / topic 노드 upsert + CONTAINS 엣지 |
| auto-add | `mandala-post-creation.ts` | PLACED_IN trigger 거의 실패 (8 rows) |
| rich-summary v2 | `kg-bridge.ts`, `v2-bridge.ts` | atom / section / concept 노드 + HAS_ATOM / HAS_SECTION / COVERS |
| 챗봇 | `ontology/chat.ts`, `context-builder.ts` | 그래프 traversal → user knowledge 컨텍스트 |
| 비디오 enrich | `enrich-worker.ts` | video_resource 노드 |
| 그래프 검색 | `ontology/search.ts` | 위계 + 768d embedding |

### 미진단 약점

**`PLACED_IN` 8 rows** — `card → sector` trigger 사실상 실패. 사용자 카드 배치가 그래프에 미반영 → 챗봇이 "사용자가 어떤 카드 봤는지" 모름.

---

## 8. Shorts cutoff — 180s

### 현재 활성 path

prod env: `VIDEO_DISCOVER_V3=1` → v3 executor.

### 함수

```ts
// src/skills/plugins/video-discover/v2/youtube-client.ts:435
export function isShortsByDuration(durationSec: number | null): boolean {
  return durationSec === null || durationSec <= 180;
}
```

v3 / v2 / youtube-provider 모두 같은 함수 import.

### 근거

- PR #401 (2026-04-17): YouTube 2024-10 정책으로 shorts 길이 60→180s 확장 반영
- prod 사고: 110s shorts "한의대수석 #공부 #공부잘하는방법" 가 60s gate 통과해 wizard 결과 오염
- `durationSec === null` → 방어적 drop (Videos.list API 가 shorts duration 누락하는 케이스 방어)

### 부작용 (mandala 7b99f68c)

`droppedShortsDuration: 137` — 영어 학습 채널의 30초~3분 짧은 영상이 cutoff 에 걸려 카드 부족의 한 축. 도메인별 분기 spec 필요.

---

## 9. Meta — 18일 ledger 정지 + oscillation 패턴

### Ledger drift (`docs/reports/wizard-dashboard-perf-log.md`)

- **Last updated: 2026-04-23** (CP419) — 본 진단 시점 2026-05-12 까지 19일 stale
- 그 동안 PR 7+ 건 (CP426~451) 이 v3 discover / wizard path 에 변경 가했으나 ledger 미반영

### 18일간의 변화 (git log on `docker-compose.prod.yml`)

```
2026-04-25  f0aa3ffd  precompute poll budget 15s→1s + conditional pipeline   (M3 60s → 12s claim)
2026-04-25  60f49d63  semantic center gate 재활성 (subword → semantic)
2026-04-26  1b19271f  rollback semantic gate + parallelize
2026-04-30  9b64885f  YOUTUBE_SEARCH_TIMEOUT 1000→3000 + bigram fallback
2026-05-02  be8d2af0  Tier 1 video_pool semantic match in prod
2026-05-03  d497ee7d  semantic center gate ON + candidate cap (V3_SEMANTIC_MAX_CANDIDATES=30)
2026-05-04  e4a48e46  mandala-filter bypass (V3_USE_YOUTUBE_RANKING_ONLY=true)   ← Issue #610 의 원인
2026-05-05  8d161467  Tier 1 cache disable (noise > signal)
2026-05-06  12fac681  Tier 0 Redis kill (lexical OFF)
```

### Oscillation 패턴 (CP418 → 본 세션)

```
CP418  semantic gate 켰다가 → subword 롤백 → 다시 semantic ON ...
2026-05-04  mandala-filter bypass (cell-level) 도입
                                  ↓
2026-05-12  bypass 가 카드 품질 망가뜨림 (Issue #610)
                                  ↓
유혹: V3_USE_YOUTUBE_RANKING_ONLY=false 단일 flip
                                  ↓
이전에 bypass 가 해결했던 false-positive 재현
                                  ↓
다시 flip ON → cell quality 망가짐 → ...
```

→ **CLAUDE.md Active Rule F** (patch-on-patch stop) 발동. 단일 env flip 금지 명시.

---

## 10. 본 세션 산출물 + 미해결

### Shipped

- **PR #609** (`e1fa6c71`) — `PRISMA_POOL_LIMIT=15`. deploy 검증 완료. Trickle 측정 대기.

### Filed (spec ticket, 코드 변경 보류)

- **Issue #610** — Card quality medical-English flooding (post PR #555). 디자인 문서 결정 의무.

### 미파일 (issue 화 여부 사용자 결정 대기)

- 카드 수량 부족 (3 layer: shorts cutoff + LLM query gen + cell 분배)
- `video_pool_embeddings` 적재 비용 vs 비활성 (10,645 rows × embed cost dormant)
- `video_chunk_embeddings` 동일 (2,641 rows dormant)
- `ontology.embeddings` (26 rows, 사실상 dead schema)
- `PLACED_IN` 8 rows (card→sector trigger 실패)
- `RICH_SUMMARY_V2_CRON_ENABLED=false` 의도된 비활성인지 미확인
- `ledger drift 18+일` 자체가 process issue

### M3 telemetry 제안 (보류)

본 세션 중반에 client-side first-card timing endpoint 구현 제안 (~115 라인, 5 파일). 사용자 답변 없이 다른 진단 라인으로 전환.

---

## 11. Cross-references

- **Ledger**: `docs/reports/wizard-dashboard-perf-log.md` (CP419 stale)
- **Anatomy**: `docs/reports/wizard-dashboard-flow-anatomy.md` (CP416 stale)
- **Design SSOT**:
  - `docs/design/precompute-pipeline.md` (Phase 2 SLO-1)
  - `docs/design/v3-semantic-center-gate.md`
  - `docs/design/v3-semantic-cell-gate.md`
  - `docs/design/progressive-relevance-stream.md`
  - `docs/design/card-refresh-strategy.md`
  - `docs/design/realtime-search-pipeline.md`
  - `docs/design/quality-gate.md`
  - `docs/design/video-pool-growth.md`
  - `docs/design/wizard-service-redesign-2026-04-22.md`
- **본 세션 origin**: 사용자 질문 "위저드에서 대시보드로 이어지는 플로우에서 너무 큰 지연이 발생하고 있고 찾지 못하는데..." (2026-04-29) → 2026-05-12 후속 진단

---

## 12. 행동 원칙 — 본 세션의 메타 결론

1. **단일 env flag flip 금지** — Rule F enforce, CP418 oscillation 회피
2. **모든 fix 는 측정 가능해야** — M3 telemetry 부재가 carryover 의 영속 원인
3. **Ledger 와 ssh source 의 일치 의무** — `docs/reports/wizard-dashboard-perf-log.md` 갱신 책임을 commit 단위 또는 CP 단위로 강제
4. **단편 fix 누적 시 stop + spec 재설계** — 본 세션의 모든 미해결 항목이 이 원칙 적용 대상
