# Insighta Hybrid Retrieval — 2026-05-12 디자인 초안

**Status**: Locked (사용자 directive 2026-05-12 "활용가능한 기능은 최대한 도입해서 활용")
**Adoption scope**: A + B + C + D 전수 도입. E (channel scan) 만 보류 (mandala-centric 모델과 conceptual 충돌).

**Origin**:
- 본 세션 진단 결과 (`docs/reports/wizard-dashboard-diagnosis-2026-05-12.md`) — 카드 품질 (Issue #610), 카드 수량, 챗봇 컨텍스트 부재
- 사용자 제안 (2026-05-12): "오픈소스 분석 + 적용 가능한 부분 도입" → YT-Navigator (MIT, 593★, https://github.com/wassim249/YT-Navigator) 분석 → Insighta 재서술

**비-목표 (Non-goals)**: Insighta 의 mandala/cell/user_video_states 모델 변경 X. 챗봇 / wizard discover / 카드 ranking 만 영향.

---

## 1. 무엇이 부족한가 (Insighta 현 상태)

| 부족 영역 | 현 prod 동작 | 데이터 |
|----------|------------|--------|
| 카드 quality | cosine (mandala_embeddings ↔ video_pool/YouTube ranking) 단일 게이트 + PR #555 mandala-filter bypass | mandala 7b99f68c top rec_score 1.0 = "의료영어회화 002" |
| 카드 quantity | shorts cutoff 180s + LLM query gen 편향 + cell 분배 불균등 | 5/8 cells 채움, droppedShortsDuration=137/290 |
| Reranking | 없음 (rec_score = mandala_embeddings cosine 그대로) | `video_chunk_embeddings` 2,641 rows dormant |
| 시간 anchor | 카드는 전체 영상 단위, 사용자가 "어디부터 의미 있나" 모름 | `video_chunk_embeddings.start_sec` 컬럼 미사용 |
| 챗봇 컨텍스트 | `ontology/chat.ts` 가 매 호출마다 graph traversal | `PLACED_IN` 8 rows = card→sector 그래프 미반영 |
| LLM cost | 매 응답마다 tool call (graph 조회) | route 분기 없음 |

---

## 2. YT-Navigator 의 어떤 패턴이 직접 응답하는가

### Pattern P1 — Hybrid retrieval + cross-encoder rerank

YT-Navigator `app/services/vector_database/tools/vector_tool.py:similarity_videos_search` 의 11-stage pipeline:

```
1. semantic search   (asimilarity_search, k=20)
2. keyword search    (BM25 또는 tsvector 자체 구현)
3. concat + bulk fetch metadata (single query)
4. dedupe by content
5. cross-encoder rerank  (BAAI/bge-reranker-v2-m3 등)
6. valid filter
7. Counter → top 5 video_ids
8. minimise_chunks (representative chunk per video)
9. MinMaxScaler 0-100 score 표준화
10. group by video + avg_score
11. sort desc, return
```

**우리 Insighta 의 카드 quality 문제 (Issue #610) 의 디자인 옵션 (c) "two-stage retrieval + rerank top-N" 과 사실상 동일.**

### Pattern P2 — VideoChunk 모델 + timestamp anchor

YT-Navigator `app/models/video_chunk.py`:
```python
class VideoChunk:
    video: FK
    start: TimeField    # 시간 anchor
    end: TimeField
    text: TextField
```

**우리는 이미 `video_chunk_embeddings(video_id, embedding vector(4096))` 존재 (2,641 rows). 그러나 시간 컬럼 없음.** 시간 anchor 추가 시:
- 카드 click 시 "0:45 부터 의미 있음" deep-link
- semantic rerank 의 결과를 segment-level 로 사용자에게 제시 → 체감 시간 ↓

### Pattern P3 — LangGraph ReAct + route 분기

YT-Navigator `app/services/agent/react_graph.py` 의 2-node 사이클:
```
agent (call_model with tools)
  ↓ tool_calls? continue : END
tools (execute)
  ↓
agent  ← loop
```

상위 `main_graph.py` (분석 미진행) 가 추가로 3-way route 한다:
- (a) direct reply (cost-cheap LLM)
- (b) static "not relevant" reply
- (c) tool_calls reply (heavier LLM)

**현재 우리 챗봇은 모든 query 에 graph traversal 수행 → cost + latency 낭비.** Route 가 있으면 "안녕하세요" 같은 trivial query 가 graph 안 탐.

---

## 3. Insighta 스택 재서술

| 영역 | YT-Navigator | Insighta 대응 | 비용 |
|------|------------|-------------|------|
| Vector store | PGVector (Django ORM) | PGVector (Prisma + `pgvector` extension, 이미 5 테이블 운영 중) | 0 — 동일 인프라 |
| Semantic search | `asimilarity_search(k=20)` | `prisma.$queryRaw` + `<=>` cosine operator (이미 v3 cache-matcher 등에서 사용 중) | 0 |
| Keyword search | BM25 (Postgres `ts_rank` 또는 외부 lib) | Postgres `to_tsvector` + `ts_rank` (TS-side: SQL 1줄) | 낮음 — 자체 구현 |
| Cross-encoder rerank | `sentence-transformers` (BAAI/bge-reranker-v2-m3) Python 직접 inference | OpenRouter 모델 호스팅 확인 필요. 없으면 Mac Mini Ollama 또는 별도 HF inference endpoint | 중간 — 모델 호스팅 결정 |
| LangGraph | `langgraph` Python | `@langchain/langgraph` (공식 TS 포팅 있음) 또는 자체 구현 | 중간 — 학습 곡선 |
| Score 표준화 | sklearn MinMaxScaler | 자체 구현 (max-min normalize, 10 줄) | 0 |

---

## 4. 차용 후보 5개 (재정렬)

### A. **Hybrid retrieval + cross-encoder rerank** — P0
- **대응**: Issue #610 (카드 quality)
- **범위**:
  - 신규 `src/skills/plugins/video-discover/v3/hybrid-rerank.ts` (모듈)
  - 입력: query, candidate list (mandala-filter 결과 + YouTube ranking)
  - 단계: BM25 search → concat → dedupe → rerank → top-N
  - mandala-filter 와 병행 도입, A/B flag
- **모델 결정 필요**:
  - OpenRouter 에 `BAAI/bge-reranker-v2-m3` 있는지 확인
  - 없으면 Mac Mini Ollama 자체 호스팅 (Ollama 가 cross-encoder 안 함 → llama.cpp / TEI server 별도)
  - 또는 Cohere `rerank-multilingual-v3.0` (유료 API, 1000 query 당 $1)
- **추정 비용**: 100 query 처리당 rerank latency +200-500ms (모델 의존). cost: Cohere 의 경우 무시 가능 ($0.001/100)
- **롤백**: A/B flag off

### B. **VideoChunk timestamp anchor** — P0 (P2 patterns)
- **대응**: video_chunk_embeddings dormancy + M3 사용자 체감
- **범위**:
  - DDL: `video_chunk_embeddings` 에 `start_sec INT, end_sec INT, text TEXT` 컬럼 추가
  - transcript 처리 코드 (`internal/transcript.ts`) 가 segment 단위로 chunk + embed + insert
  - FE: 카드 click 시 `youtube.com/watch?v=<id>&t=<start_sec>s` deep-link
- **추정 비용**: 영상당 ~10-30 chunks × embed (qwen3-embedding:8b). 기존 transcript pipeline 에 segment loop 추가
- **롤백**: 컬럼 그대로 두고 FE link 만 비활성

### C. **LangGraph ReAct + 3-way route (챗봇)** — P1
- **대응**: 챗봇 cost / latency + route 결정
- **범위**:
  - 신규 `src/modules/ontology/chat-graph.ts`
  - 3 노드: `route_message` (cheap LLM) / `tool_call_agent` (powerful LLM) / `static_reply`
  - 기존 `ontology/chat.ts` 와 병행 (flag)
- **추정 비용**: 학습 곡선 (LangGraph TS) — ~1-2 day. cost 절감 분명 (cheap LLM route 우선)
- **롤백**: flag

### D. **Score 표준화 (MinMaxScaler) + group by video** — P2
- **대응**: 현재 rec_score 분포가 너무 평탄 (top 0.99 → 0.88 → 0.95 등 unreliable)
- **범위**: rec_score 를 0-100 표준화 + cell 별이 아니라 video 별 group + avg_score
- **추정 비용**: SQL view + FE 정렬 한 번. 작음
- **롤백**: view 삭제

### E. **Channel-level scan 모드** — P3 (보류)
- **대응**: 신규 user flow ("이 채널 깊이 학습")
- **비용**: 큼 — endpoint + UI + scan worker
- **위험**: mandala-centric 모델과 conceptual 충돌
- **결정**: P0/P1 효과 확인 후 재검토

---

## 5. 단계별 도입 plan

### Phase 1 — 자료 / 결정 (코드 변경 0)
1. **OpenRouter `BAAI/bge-reranker-v2-m3` 호스팅 여부 확인** (또는 alternatives — Cohere, Voyage)
2. **LangGraph TS 도입 비용 평가** — POC 1개 (route_message 단일 노드)
3. **본 디자인 문서를 Issue #610 의 (c) 옵션 spec 으로 lock**

### Phase 2 — Hybrid rerank shadow (Pattern A, flag-off)
1. `hybrid-rerank.ts` 모듈 구현 (BM25 + concat + dedupe + rerank)
2. `V3_ENABLE_HYBRID_RERANK=false` env 도입, shadow 모드 — recommendation_cache 에 두 set 저장
3. 5+ mandala (finance / health / hobby / education / career) 의 A/B 비교 1주일
4. 결과: hybrid 가 control 보다 top-5 cosine 평균 ≥ 0.1 높으면 활성화

### Phase 3 — VideoChunk timestamp (Pattern B)
1. DDL 추가 (`start_sec`, `end_sec`, `text`)
2. transcript pipeline (`internal/transcript.ts`) 에 segment loop
3. 기존 2,641 rows 는 `start_sec=NULL` 그대로, 신규만 시간 anchor
4. FE deep-link 한 줄

### Phase 4 — LangGraph chatbot (Pattern C)
1. `@langchain/langgraph` 도입 + `chat-graph.ts` POC
2. 기존 `ontology/chat.ts` 와 병행
3. cost / latency 비교 후 flip

### Phase 5 — Score 표준화 + group by video (Pattern D)
- Phase 2 hybrid 안정화 후 적용

---

## 6. 결정 — Lock-in (2026-05-12)

| 항목 | 결정 | 근거 |
|------|-----|-----|
| Reranker 모델 | **Cohere Rerank API (`rerank-multilingual-v3.0`)** | (1) Mac Mini 는 production-critical inference 의 *임시 scaffold* 이지 영구 위치 아님 — 단일 머신 / SLA 불가 / Seoul↔us-west-2 latency. 더 키우지 않음. (2) OpenRouter 에 reranker 없음 (확인). (3) Cohere = zero ops, 100-200ms latency, multilingual (Korean), traffic 에서 cost < $10/mo. (4) 신규 API key + credentials.md 업데이트는 일회성 비용. **별 track 으로 Mac Mini 의 기존 LoRA 는 RunPod Serverless 로 마이그레이션 (CP449 챗봇 패턴 복제) 예정.** |
| LangGraph | **`@langchain/langgraph@1.3.0` TS 도입** | 공식 TS 포팅 안정. 자체 구현 (~200 lines) 대비 ecosystem (HITL, checkpointing, streaming) 가치 큼 |
| Keyword search | **Postgres `to_tsvector` + `ts_rank`** | 외부 lib 0. BM25 와 정확히 같지 않지만 keyword recall 효과 충분. 추가 인덱스 1개 |
| Rerank 호출 빈도 | **매 wizard 시 1회, 결과는 `recommendation_cache.rec_score` 저장 (재호출 X)** | 추가 LLM 호출 없음. recompute 만이 갱신 |
| Score 표준화 | **자체 구현 (max-min normalize, 10 줄)** | sklearn 의존 X |

---

## 7. 본 디자인의 메타-원칙 (CLAUDE.md alignment)

- **단편 fix 금지** (Rule F) — flag flip 아니라 spec-level 통합
- **측정 가능성** — Phase 2 shadow 모드로 A/B 정량 비교 (Rule G "valid rate + p95 + failure modes" 적용)
- **롤백 즉시성** — 모든 Phase 가 flag-off 로 환원
- **Plan→Approve→Execute** — 본 문서가 Plan, 사용자 승인 후 Phase 1 진행
- **단일 PR 안 3 hotfix 누적 시 stop** — Phase 2 가 1주일 안에 ≥ 2 rollback 발생 시 디자인 iter reset

---

## 8. 실행 시퀀스 (lock-in, 2026-05-12 amendment)

**Amendment 근거**:
- 사용자 directive: "Mac Mini 는 임시 패턴, 향후 BE 통합되어야" → reranker 를 Mac Mini TEI 에 올리지 않고 처음부터 BE-native (Cohere) 로
- 데이터 점검: `video_chunk_embeddings` schema 에 `text/start_time/end_time/chunk_idx` **이미 존재** + 2,641 rows 적재 (Mac Mini A1→A4 batch 가 채움). 우리 BE 에서 INSERT 코드 0건
- → 원래 PR1 (DDL + transcript segment loop) 의 가정이 부분 무효. 시퀀스 축소.

### 새 시퀀스 (3 PR)

#### PR1 — Pattern A + D (Hybrid retrieval + Cohere rerank + score normalize) — Issue #610 fix
- **이유**: 가장 큰 user-facing 효과, prerequisite 없음 (chunk data + schema 이미 있음, reranker = Cohere API)
- **범위**:
  - `src/modules/rerank/cohere-client.ts` — `POST https://api.cohere.com/v2/rerank` wrapper (axios, retry, timeout)
  - `credentials.md` — `COHERE_API_KEY` 등록 + `.env` 에 추가 절차 명시 (실제 키는 .env 만, repo X)
  - `src/skills/plugins/video-discover/v3/hybrid-rerank.ts` — pipeline:
    - 입력: mandala-filter 결과 candidate list
    - 단계: tsvector keyword search → concat → dedupe → cohere rerank → top-N → score 0-100 normalize → group by video (avg) → sort
  - `v3/executor.ts` 통합 — `V3_ENABLE_HYBRID_RERANK=true` env (default ON after merge)
  - PR #555 `V3_USE_YOUTUBE_RANKING_ONLY=true` 의 cell-quality 문제를 hybrid+rerank 가 대체
- **검증**:
  - 단위 테스트: cohere-client mock + hybrid-rerank.ts (5+ test)
  - 회귀 mandala (7b99f68c, 영어 학습): 의료영어 oversaturation 사라지는지 manual 확인 → Issue #610 close
  - cost telemetry: 일 1주일 cohere 호출 수 + cost 로그
- **롤백**: `V3_ENABLE_HYBRID_RERANK=false`

#### PR2 — Pattern C (LangGraph ReAct + 3-way route 챗봇)
- **이유**: 챗봇 cost / latency / 응답 품질. PR1 와 독립적 (vectorSearchTool 은 PR1 의 hybrid-rerank.ts wrapping 으로 재사용 가능, 그러나 PR1 머지 전에도 기존 v3 path wrap 가능)
- **범위**:
  - `npm i @langchain/langgraph @langchain/core`
  - `src/modules/ontology/chat-graph.ts` 신규
  - 3 노드:
    - `route_message` — cheap LLM (Haiku 또는 Qwen 7B RunPod) 으로 분류: (a) direct (b) static_not_relevant (c) tool_call
    - `static_reply` — 정해진 응답
    - `tool_call_agent` — powerful LLM (Haiku 4.5 또는 Gemini 2.5) + tools (vectorSearch + sql)
  - 도구 2개: `vectorSearchTool` (hybrid-rerank wrapping), `sqlTool` (user_video_states / mandala_levels select-only)
  - 기존 `ontology/chat.ts` flag-off, 신규 path `CHAT_USE_LANGGRAPH=true`
- **검증**:
  - trivial query ("안녕") → cheap LLM 만 호출, cost 측정
  - 복잡 query → tool_call agent 가 도구 호출
  - 응답 latency p50/p95 vs 기존 chat.ts

#### PR3 — FE timestamp deep-link (Pattern B 부분 — 카드 click)
- **이유**: video_chunk_embeddings 의 start_time data 가 이미 있으나 사용자에게 노출 X. PR1 의 rerank 결과에 chunk start_time 도 전파되도록 보강 후 FE 단순 추가.
- **범위**:
  - PR1 의 hybrid-rerank 결과 schema 에 `start_sec` 포함
  - FE 카드 click 시 `youtube.com/watch?v=<id>&t=<start_sec>s` deep-link (한 줄)
  - chunk → card 매핑: 한 video 의 top-scored chunk 의 start_time 을 카드의 anchor 로
- **검증**: 카드 click 시 시간 anchor 적용 youtube 페이지 열림

### 보류

- **Pattern B 의 transcript.ts segment loop 부분**: write path 가 Mac Mini batch (외부) — 별도 spec
- **Pattern E (channel scan)**: mandala-centric 모델 충돌 — backlog
- **Mac Mini deprecation 전체 roadmap**: 별 spec doc 으로 분리 (LoRA action-fill → RunPod 이동, etc.)

---

## 9. Cross-references

- Source: [YT-Navigator](https://github.com/wassim249/YT-Navigator) (MIT, 593★, last updated 2026-05-10)
- 본 세션 진단: `docs/reports/wizard-dashboard-diagnosis-2026-05-12.md`
- 관련 Issue: #610 (Card quality medical-English flooding)
- 관련 PR: #555 (mandala-filter bypass), #556 (Tier 1 cache disable), #609 (Prisma pool fix)
- 기존 디자인:
  - `docs/design/v3-semantic-center-gate.md`
  - `docs/design/v3-semantic-cell-gate.md`
  - `docs/design/progressive-relevance-stream.md`
  - `docs/design/card-refresh-strategy.md`
  - `docs/design/realtime-search-pipeline.md`
  - `docs/design/quality-gate.md`
