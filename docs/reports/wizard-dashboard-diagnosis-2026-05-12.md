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

---

## 13. PR 시퀀스 merge cycle (2026-05-13 새벽, 누적)

> "github에 pr 이 많이 쌓여 있는데... 우선순위와 영향도, 리그레션 등 고려해서 순차 진행해" — 사용자 directive

### 13.1 Merge order + prod 검증 결과

| Order | PR | 효과 | Prod 검증 | sha |
|-------|----|------|-----------|-----|
| 1 | #611 | docs (hybrid retrieval spec) | n/a | `21703493` |
| 2 | #615 | docs (Mac Mini deprecation roadmap) | n/a | `040808f0` |
| 3 | #618 | mig 017 sync_mandala seq-scan 879× | ✅ tx 5616→238ms (이전 단계) | (이전) |
| 4 | #616 | IKS_EMBED_PROVIDER=openrouter (step 1: 20.4s→0.89s, 75×) | ✅ (이전) | (이전) |
| 5 | #619 | auto-add bulk INSERT (step 3: 8.2s→~3.2s 기대) | ✅ uptime 117s reset | `96b099a7` |
| 6 | #614 | YouTube timestamp deep-link (startSec via chunk anchor) | ✅ uptime 45s reset | `4743a06c` |
| 7 | #617 | trend-collector OpenRouter fallback (Phase D1-b) | ✅ uptime 217s reset | `12b26af0` |
| 8 | #612 | Cohere hybrid rerank + keyword expansion (flag-off) | ✅ uptime 39s reset | `0a2ce3b2` |
| 9 | #613 | LangGraph 3-way chatbot route (flag-off) | ❌ **revert** (502) | `152a8490` → `b2206513` revert |

### 13.2 누적 wizard 파이프라인 예상 단축 효과

- step 1 (embed): **20.4s → 0.89s** (−19.5s, OpenRouter cloud GPU vs Mac Mini M4)
- step 3 (auto-add): **8.2s → ~3.2s** (−5s, 102 roundtrips → 24)
- mig 017 sync_mandala trigger: **5.4s → 0.24s** (−5.1s, seq scan 879× fix)
- **합산 ~30s 단축 → 12s 목표 안쪽 진입** (사용자 manual 검증 필요)

### 13.3 PR #613 prod 회귀 (2026-05-13 ~08:32 KST)

**증상**: insighta.one 전체 502 Bad Gateway

**Root cause (SSH `docker logs insighta-api`)**:
```
Error [ERR_PACKAGE_PATH_NOT_EXPORTED]: Package subpath './language_models/stream'
is not defined by "exports" in /app/node_modules/@langchain/core/package.json
    at Object.<anonymous> (/app/node_modules/@langchain/langgraph/dist/stream/transformers/messages.cjs:3:46)
```

**원인 분해**:
1. `@langchain/langgraph` 의 `dist/stream/transformers/messages.cjs` 는 `@langchain/core/language_models/stream` subpath 를 `require()`
2. 설치된 `@langchain/core@0.3.80` 의 `package.json.exports` 에 해당 subpath 정의 없음 → peer-dependency version mismatch
3. **flag-off 가정 깨짐**: `CHAT_USE_LANGGRAPH=false` 라도 `chat-graph.ts` 가 ts 모듈에서 정적 import 되어 require 단계에 진입 → 컨테이너 startup 시점에 crash
4. `node:20-alpine` prod 환경 ↔ local Node 24 dev 환경 차이로 local tsc/jest 통과 → false negative

**복구 액션**:
- `git revert --no-edit 152a8490` → commit `b2206513`
- `git push origin main` → revert deploy run 25767331760 → uptime 94s reset → HTTP 200 회복

**총 prod down time**: ~30분 (18:32 UTC 발생 → ~19:15 UTC 복구)

### 13.4 사용자 후속 액션 (활성화 필수)

#### #612 (Cohere hybrid rerank) — flag 미활성 시 prod 무영향
1. **GitHub Secret 추가**: `COHERE_API_KEY` (Cohere 콘솔에서 발급, `rerank-multilingual-v3.0`)
2. **Flag flip PR**: `docker-compose.prod.yml` 에 `V3_ENABLE_HYBRID_RERANK=true`
3. 활성 후 검증: mandala 7b99f68c (Issue #610 regression) → 황창연/광고 채널 제거 여부

#### #617 (trend-collector OpenRouter) — PR 내 `TREND_EXTRACT_PROVIDER=openrouter` 포함, 자동 적용
- 별도 액션 불필요. cron trend-collector 실행 시 적용 확인.

#### #614 (timestamp deep-link) — Cohere/LangGraph flag 없이 즉시 사용
- 검증: 카드 클릭 → YouTube URL `&t=<sec>s` 적용 여부

#### #613 (LangGraph) — re-attempt 전 필수 조건
1. `@langchain/langgraph` 와 호환되는 `@langchain/core` 버전 핀 결정 (또는 langgraph downgrade)
2. **node:20-alpine prod 이미지에서 직접 require 테스트**: `docker run insighta-api:test node -e "require('@langchain/langgraph')"`
3. `chat-graph.ts` 를 **lazy dynamic import** 로 전환 (flag-off 시 require 단계 진입 차단)
4. CI 에 prod-image startup smoke 추가 (`docker run … node -e "require('./dist/server')"`)

### 13.5 회귀 lesson (troubleshooting.md 후보)

**Pattern**: `flag-off default 라도 정적 import 는 require 단계 진입` → CJS/peer-dep 충돌 패키지는 dynamic import 필수.

**Pattern**: `local node !== prod node:20-alpine` → tsc/jest PASS 가 startup OK 를 보장하지 않음. peer-dep-sensitive 패키지 도입 시 prod Docker 빌드 + `node -e "require(...)"` smoke 의무.

**Pattern**: `package-lock.json` 의 peer-dep resolution 이 prod 와 다를 수 있음. 의존성 추가 PR 은 Docker 이미지 build → startup smoke job 추가 필요.

### 13.6 main 최종 상태 (2026-05-13 ~08:15 KST)

```
b2206513 Revert "feat(chatbot): LangGraph ReAct + 3-way route (PR2 spec, flag-off) (#613)"
0a2ce3b2 feat(v3): hybrid retrieval + Cohere rerank (Issue #610 spec, flag-off) (#612)
12b26af0 feat(trend-collector): OpenRouter fallback for llm-extract (Phase D1-b) (#617)
4743a06c feat(recommendations): YouTube timestamp deep-link from chunk anchor (PR3) (#614)
96b099a7 perf(auto-add): bulk INSERT — 102 roundtrips → 24 (#619)
040808f0 docs(spec): Mac Mini deprecation roadmap (#615)
21703493 docs(spec): hybrid retrieval design + session diagnosis (#611)
```

Prod HTTP 200 ✅. Wizard 파이프라인 단축 효과는 다음 사용자 manual 위저드 생성으로 측정 예정.

---

## 14. SSE 401 + Polling fallback 점검 (2026-05-13 ~08:50 KST)

### 14.1 사용자 보고

> "리그래션 40초 넘어감." → "기존데로 60초 넘어가는듯." → "70초? 납득불가능해 > 10초로 개선해"
> "fallback 이면, 보험성격인데 70초 대기가 뭐야? 설계 오류 아니야?"

### 14.2 측정된 사실 (mandala `d155a979` 2026-05-13 KST 08:40)

**BE 타임라인** (UTC ms, T=0 = wizard-stream 시작):

| 시점 | T+ms | 이벤트 (출처) |
|------|------|--------------|
| 1778629204833 | 0 | POST /wizard-stream 시작 |
| 1778629210636 | **+5803ms** | /wizard-stream 응답 200 (req-27) |
| 1778629213495 | +8662 | POST /create-with-data 시작 |
| 1778629215170 | +10337 | /create-with-data 응답 200 |
| 1778629219843 | **+15010** | recommendation_cache 12 rows populated (DB) |
| 1778629220145 | +15312 | user_video_states 12 rows populated (DB) |
| 1778629305410 | **+100577** | /pipeline-status GET (api 컨테이너의 FE 첫 후속 흔적) |

**BE end-to-end = 15.3s** (wizard-start → 모든 cards DB 확정).
**+85s 갭** = cards 준비 → FE 가 다음 api 호출까지의 무활동 구간.

### 14.3 SSE 401 측정

`docker logs insighta-api --since 24h | grep '/videos/stream'`:
- 24h 동안 5건의 SSE 시도 → **5/5 401 반환** (각 응답시간 < 1.1ms = preHandler 에서 거부)
- 401 응답시간 < 1.1ms = `request.jwtVerify()` 의 "No Authorization header" 즉시 거부

### 14.4 근본 원인 (코드 사실)

**`src/api/plugins/auth.ts:137-189`**:
- `fastify.decorate('authenticate', ...)` → `request.jwtVerify()` 호출 → `@fastify/jwt` 기본 동작 = `Authorization: Bearer <token>` 헤더만 읽음.

**`frontend/src/features/recommendation-feed/model/useVideoStream.ts:100-105`** (잘못된 주석):
```ts
// "The backend route uses the same `fastify.authenticate` plugin... reads the
//  token from either header or access_token query param (supabase jwt plugin convention)."
const url = `${API_BASE_URL}/api/v1/mandalas/${mandalaId}/videos/stream?access_token=${encodeURIComponent(accessToken)}`;
```

**불일치 = 본 버그의 본질**. FE 는 `?access_token=` 으로 보냈지만 BE 는 헤더만 읽음. SSE 도입(CP416 Phase B) 시점부터 broken.

### 14.5 Fallback 설계 오류 (사용자 지적 사실 확인)

**`frontend/src/features/recommendation-feed/model/useRecommendations.ts:40-47`**:
```ts
const REC_FEED_STALE_TIME_MS = 5 * 60 * 1000;  // 5 분
// refetchInterval 없음
```
→ SSE 가 죽어도 5분간 자동 재요청 없음. 진짜 fallback 아님.

**`frontend/src/pages/index/ui/IndexPage.tsx:245-271`** — 별도의 post-creation 폴링:
- `isNewMandalaActive` = `justCreatedMandalaId === effectiveMandalaId && !!effectiveMandalaId` 일 때만 시작
- 2s interval, 90s timeout
- `cards.totalCards > 0` 시 즉시 중단
- 폴링 대상: `youtubeSyncKeys.allVideoStates` (Supabase Edge Function — EC2 api 로그에 잡히지 않음)

**측정 불가**: justCreatedMandalaId 가 실제 set 됐는지 + Edge Function 폴링 cadence + Edge Function 응답시간 → 브라우저 DevTools Network + Supabase Functions 로그가 필요.

### 14.6 즉시 적용된 fix (PR #620)

**`src/api/plugins/auth.ts`** — `jwtVerify` 호출 전 query token 을 header 로 합성:
```ts
const queryToken = (request.query as Record<string, string> | undefined)?.['access_token'];
if (!request.headers.authorization && queryToken) {
  request.headers.authorization = `Bearer ${queryToken}`;
}
const decoded = await request.jwtVerify<SupabaseJWTClaims>();
```

- Header 가 있으면 기존 동작 그대로 (early return path 동일)
- Header 부재 + query token 있음 → SSE 인증 성공 → `card_added` SSE 이벤트 즉시 수신 가능

**검증된 항목**: tsc clean / hardcode-audit baseline 33 / auth-guard.test.ts pass / CI 6/6 PASS / merged main `5d3c56e6`.

### 14.7 PR #620 만으로 부족한 부분 (사용자 지적 사실)

PR #620 = **SSE 자체** 가 동작하도록 만들 뿐. fallback 설계 결함은 별도 작업 필요:

**필요 후속 (영향도순)**:
1. **`useRecommendations`** 에 `refetchInterval: 5000ms` (5초 폴링) — 새 mandala 가 아닌 일반 dashboard 에서도 SSE 죽었을 때 진짜 백업 동작
2. **`useVideoStream` 의 error 상태를 `useRecommendations` 에 신호** → SSE error 시 `useRecommendations` 의 interval 단축 (5s → 2s)
3. **wizard-stream 5.8s 단축** — LLM gen 단계가 BE 의 가장 큰 비중. 별도 PR.
4. **`get-all-video-states` Edge Function 응답시간 측정** — 측정 후 필요시 캐싱/인덱스 최적화.

### 14.8 검증 측정 필요 (사용자 다음 테스트 시)

PR #620 deploy 완료 후 **브라우저 DevTools** 로:
- Network 탭 → `/api/v1/mandalas/<id>/videos/stream` 응답 코드 (200 = SSE 정상 연결 / 401 = 여전히 broken)
- Network 탭 → `card_added` SSE 이벤트 도착 시각 (mandala create 후 ~6s 내 첫 이벤트 = 정상)
- Network 탭 → `/functions/v1/get-all-video-states` 호출 간격 (2s 주기 = 폴링 정상)
- 콘솔 → `[DEBUG-WIZARD] setJustCreated called with:` 출력 시각

이 데이터 없이는 "70s → ?s" 의 결과를 단정 불가.

---

## 15. SSE 안정성 8 risk 전수 점검 (2026-05-13 KST ~10:15)

사용자 directive: "sse 를 우회해서 fallback 하는것도 중요한데. sse 가 반드시 잘 동작하도록 설계를 해야지" — primary path 안정성 점검 8 risk 매트릭스 측정.

### 15.1 측정 결과

| # | Risk | 측정 결과 (사실) | 영향 |
|---|------|-----------------|------|
| 1 | 인증 (`?access_token=` query) | ✅ PR #620 fix 적용 (last 15min 401 = 0건) | OK |
| 2 | nginx `proxy_buffering` | ❌ `proxy_buffering on` (`/etc/nginx/sites-enabled/insighta` 측정). BE handler 가 `X-Accel-Buffering: no` 헤더 설정 (mandalas.ts:2387) — nginx honor 여부 미측정 | SSE chunks 가 nginx buffer 에 accumulated → real-time push 차단 가능 |
| 3 | BE heartbeat 간격 | ✅ `setInterval(20s)` 명시 (mandalas.ts:2468) | nginx 180s timeout 보다 짧음 = OK |
| 4 | FE reconnect / Last-Event-ID / backlog catchup | ❌ `EventSource` 자동 재연결만 (브라우저 native). `Last-Event-ID` 사용 0건, 재연결 후 backlog GET 0건 | 재연결 사이 카드 누락 가능 |
| 5 | Server restart graceful shutdown | ❌ `src/index.ts` 의 SIGTERM/SIGINT handler **0건**. deploy 시 컨테이너 SIGKILL → SSE 연결 폭력적 종료 | deploy 직후 사용자 카드 누락 |
| 6 | CORS (reply.hijack() bypass @fastify/cors) | ✅ CP449 manual Access-Control-* header set | OK |
| 7 | BE 관찰성 (open/emit/close 로그) | ❌ SSE handler (mandalas.ts:2360-2490) `log.info/logger.info` **0건**. `reply.hijack()` 으로 standard res log 도 미기록 | **SSE 실제 동작 여부 측정 불가 = root cause** |
| 8 | Publisher connection leak / limit | ⚠️ `MemoryCardPublisher.subscribe` 의 `unsubscribe` 가 idempotent (off flag), `cleanup` 이 `request.raw.on('close')` + `'error'` 둘 다 listen — 단 mid-stream network timeout 시 `'close'` 미 fire 가능, 그 경우 listener 누수 | 낮음 |

### 15.2 Critical 3종

1. **nginx `proxy_buffering on`** = SSE event chunks 가 nginx 에 buffer 되어 FE 가 real-time push 안 받을 가능성. `X-Accel-Buffering: no` 헤더가 작동하는지 별도 측정 (`curl -N` direct vs nginx 경유 응답 비교) 필요.
2. **BE 관찰성 0건** = SSE 가 정말 동작하는지 측정 자체 불가. 모든 후속 측정 (heartbeat 도달 / event emit 빈도 / disconnect 원인) 의 prerequisite.
3. **Graceful shutdown 0건** = deploy 시 SSE 끊김이 사용자 경험에 영향. FE 자동 재연결로 부분 회복 가능하나 backlog catchup 부재로 카드 누락.

### 15.3 권장 작업 (영향도 × 즉시성)

| 순위 | 작업 | 파일 변경 |
|------|------|----------|
| 1 | **BE 관찰성 로그** 추가 (open/emit/close + duration) — 다른 모든 risk 측정 prerequisite | `mandalas.ts` +5 lines |
| 2 | **nginx proxy_buffering off** (SSE location 명시) + redeploy nginx config | `/etc/nginx/sites-enabled/insighta` 1 line (+) |
| 3 | **graceful shutdown** SIGTERM handler — fastify.close() + 30s drain | `src/index.ts` +20 lines |
| 4 | **FE heartbeat 감시** — 30s 동안 heartbeat/event 0건 시 강제 reconnect | `useVideoStream.ts` +20 lines |
| 5 | **Last-Event-ID + backlog catchup** on reconnect | `useVideoStream.ts` + `mandalas.ts` +15 lines |
| 6 | **Publisher leak hook** — mid-stream timeout 시 explicit cleanup | `publisher.ts` +5 lines |

### 15.4 측정 코드 ref

- nginx config: `/etc/nginx/sites-enabled/insighta`
- BE SSE handler: `src/api/routes/mandalas.ts:2360-2492`
- BE publisher: `src/modules/recommendations/publisher.ts:107-118`
- FE EventSource: `frontend/src/features/recommendation-feed/model/useVideoStream.ts:62-172`
- server entry: `src/index.ts`

---

## 16. D-2 unified semantic-gate design (2026-05-13 ~12:30 KST)

### 사용자 directive

> "부분적 수정만 하면 상호 베타적 문제가 끊임없이 발생해. 전체 목표 차원에서 본질을 반드시 생각해. 전체 차원에서 작업을 조율"

본 세션 누적 partial fix (Cohere flag-flip / GIN index / OR-tsquery / ephemeral hybrid-rerank push) 의 한계 확인 — 양쪽 path (main + wizard-precompute) 에 의미 기반 필터 layer 부재가 unified root cause.

### 측정된 root cause (사실)

- 사용자 mandala `05d7ff7e` "일주일 코딩테스트 준비하기" 47장 중 10장 noise (수영/이더리움/JLPT/발로란트/바이브코딩/배당주/MLOps)
- `recommendation_cache` rec_reason 분포: realtime 27 (0 noise) / cache 20 (10 noise = 50%)
- → 100% noise 는 commit `2ad5da3d` 의 OR-tsquery keyword expansion 출처 (cache rec_reason)
- 의미 layer 매트릭스 (M4 측정):
  - main path (runV3VideoDiscover, executor.ts:805): mandala-filter 호출 있으나 `V3_USE_YOUTUBE_RANKING_ONLY=true` 로 bypass (PR #555)
  - wizard-precompute path (runDiscoverEphemeral): mandala-filter 호출 자체 없음
  - → 양쪽 모두 의미 기반 center gate 비활성 = rule-based token match (jaccard, tsvector OR) 가 noise 생성

### 본질 (한 줄)

양쪽 path 에 mandala-filter (이미 코드 존재, `V3_CENTER_GATE_MODE=semantic` 활성) 를 일관 적용. 노이즈 감소 효과는 deploy + 측정 후 결정.

### 변경 사항 (단일 commit)

1. `docker-compose.prod.yml`: `V3_USE_YOUTUBE_RANKING_ONLY=true` 라인 삭제 → mandala-filter 활성 (main path 의 의미 layer 복원)
2. `src/skills/plugins/video-discover/v3/executor.ts:runDiscoverEphemeral`: embedBatch + applyMandalaFilterWithStats 호출 추가 (wizard-precompute path 에 의미 layer 추가)
3. `applyHybridRerank` 호출 site 양쪽 (main + ephemeral): `enableKeywordExpansion` 제거 (default false, 의미 처리 부재 OR-tsquery 노이즈 source)
4. dead code 정리 (사용자 directive): `tsvectorKeywordCandidates` 함수 + `KeywordCandidate` interface + `tokenizeLower` / `countTokenOverlap` 헬퍼 + `subGoals` / `enableKeywordExpansion` / `keywordExpansionLimit` 파라미터 + `_keywordFullData` dead branch + `keywordAdded` stat 모두 삭제 (`hybrid-rerank.ts` + `executor.ts`)

### 사실 vs 가설 (사용자 directive "추측 금지")

**사실 (코드 변경 후 보장)**:
- mandala-filter (`applyMandalaFilterWithStats`) 양쪽 path 호출
- semantic center gate (cosine ≥ 0.35) 활성
- tsvector OR-tsquery keyword expansion 코드 제거됨

**가설 (deploy 후 측정 필요)**:
- noise 감소 효과 (얼마나?)
- cards/mandala 변화 (감소 가능)
- semantic gate threshold 0.35 의 적절성

### 검증 측정 (deploy 후)

- `docker logs | grep '\[ephemeral\] mandala-filter'` → 의미 layer 동작 확인
- 사용자 새 wizard test → mandala_pipeline_runs.step2_result.hybrid_rerank stats 비교
- noise rate 측정 (이전 50% → ?)
- 사용자 시각 평가

### 리스크 / 롤백

- semantic gate strict 시 cards 수 급감 가능 — threshold 0.35 → 0.25 조정 가능
- embedBatch 추가 호출 latency 증가 (~수백 ms)
- 롤백: 단일 commit revert 또는 env flag 복원 (`V3_USE_YOUTUBE_RANKING_ONLY=true` 재추가)

### PR #555 context (origin)

PR #555 (2026-04-28, commit body) 가 mandala-filter bypass 도입한 이유 = **token-jaccard heuristic noise** (substring center gate mode 시절). 본 D-2 의 차이 = `V3_CENTER_GATE_MODE=semantic` 활성 → cosine embedding 기반 center gate 로 token-jaccard 약점 해결 가능 (가설, 측정 후 확정).

PR #555 의 out-of-scope 명시: "Re-enabling mandala-filter as a post-rank refiner under flag once YouTube ranking-only baseline is measured" — 본 D-2 가 그 후속.

