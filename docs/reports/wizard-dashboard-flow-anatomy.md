# Wizard → Dashboard End-to-End Flow Anatomy

**Purpose**: e2e 각 모듈의 **실제 코드**, **프롬프트 원문**, **SQL 원문**, **timing 측정 포인트**, **결과 도달 검증 지점** 을 한 화면에서 보기 위한 reference. 실험 시도/결과 ledger 는 `wizard-dashboard-perf-log.md` 에서 관리. 이 파일은 "무엇이 실제로 실행되는가" 의 사실 스냅샷.

**Last updated**: 2026-04-22 (CP416 말, Lever A+ 이후)

---

## E2E flow (module sequence)

```
Client (wizard) ─POST /create-with-data─▶ API Route
                                              │
                                              ▼
                              [A] manager.createMandala() ───┐
                              ┌───────────────────────────┐  │
                              │  TRANSACTION (tx)         │  │
                              │  [B1] user_mandalas.create│  │
                              │  [B2] user_mandala_levels │  │  ★ Wizard 저장 시간 측정 구간
                              │       .createMany         │  │     (M1, M2, M7)
                              │  [B3] findUnique          │  │
                              │       (DB trigger [C]    │  │
                              │        auto-fires)        │  │
                              └───────────────────────────┘  │
                                              │              │
                                              ▼              │
                              setImmediate() fire-and-forget │
                              ┌────────┬──────────┬────────┐ │
                              ▼        ▼          ▼        ▼ │
                        [D1] Pipeline [D2] Fill  [D3] Sync  │
                             Run       Missing   Ontology   │
                             │         Actions   Edges      │
                             ▼         │         │          │
                    [E] Embeddings     ▼         ▼          │
                       (Ollama         [F] LoRA  [K] goal+  │
                        qwen3-8b)     → Haiku   topic nodes │
                             │        fallback  +edges      │
                             ▼            │       upsert    │
                    [G] Video-Discover v3 │                 │
                       ├ YouTube search   ▼                 │
                       ├ Tier 1 semantic  DB update         │
                       │   center gate    user_mandala_     │
                       ├ Tier 2 cell      levels.subjects   │
                       │   assign         (generation_log)  │
                       ├ (optional) semantic rerank          │
                       └ upsert recommendation_cache         │
                             │                               │
                             ▼                               │
                    [H] Auto-add → user_video_states         │
                        + cardPublisher.notify               │
                             │                               │
                             ▼                               │
Client (dashboard) ◀─[I] GET /recommendations ◀──────────────┘
                      + SSE /:id/videos/stream
                       (backlog emit → live subscribe)
                             │
                             ▼
                    [J] useVideoStream (FE)
                        + insertByScoreDesc (binary)
                        + RecommendationFeed 전역 재정렬
```

---

## Module A — POST /create-with-data (API entry)

**파일**: `src/api/routes/mandalas.ts`, `src/modules/mandala/manager.ts:351-475`

**입력**: `{ title, levels, focus_tags, language, target_level, setAsDefault? }`

**외부 호출**: DB only (Prisma)

**타이밍 로그 (`[mandala-create-timing]`)**:
- `dup_check` (manager.ts:367) — 현재 no-op (2026-04-16 이후)
- `parallel_reads` (manager.ts:387) — subscriptions + auth.users + mandala count
- `tx_mandala_create` (manager.ts:424)
- **`tx_levels_createMany` (manager.ts:428)** ← M7 측정 대상
- `tx_find_unique` (manager.ts:441)
- `tx_total` (manager.ts:454)

**핵심 결과 도달 검증**: 응답 200 + `mandala.id` 반환 + 클라이언트 navigate. 실제 저장 완결성은 post-creation 파이프라인에서 비동기 검증.

---

## Module B — $transaction (wizard save tx)

**파일**: `src/modules/mandala/manager.ts:413-453`, `:176-228`

**SQL (Prisma 호출 순서)**:
```ts
// B1: 메인 mandala row
tx.user_mandalas.create({ data: { id, user_id, title, focus_tags, ... } })

// B2: depth=1 levels 전부 한 번에 (9 row)
tx.user_mandala_levels.createMany({
  data: levels.map(l => ({ id, mandala_id, parent_level_id, level_key,
    center_goal, center_label, subjects, subject_labels, position, depth, color }))
})
// ★ Postgres 트리거 trg_sync_mandala_level (mig 004) 이 여기서 발화:
//   → ontology.nodes 에 type='mandala_sector' 행을 row 단위로 INSERT (9 row)

// B3: 최종 상태 반환용 findUnique (mandala + levels)
tx.user_mandalas.findUnique({ where: { id }, include: { levels: true } })
```

**트랜잭션 타임아웃**: `TX_TIMEOUT_MS = 60_000` (manager.ts:33). 연혁: 5s → 30s (CP358) → 60s (2026-04-18 incident).

**현재 살아있는 DB 트리거** (2026-04-22 Lever A+ 이후):
- ✅ `trg_sync_mandala_level` (mig 004) — `mandala_sector` 노드 생성. **유지** (기초 row, 비용 9 row × 1 INSERT = ~18 queries).
- ❌ `trg_goal_edge`, `trg_topic_edges` (mig 011 에서 DROP)
- ❌ `trg_sync_goal`, `trg_sync_topics` (mig 012 에서 DROP)

**결과 도달 검증**: tx 커밋 시 `user_mandalas`, `user_mandala_levels`, `ontology.nodes (type=mandala_sector)` 3 테이블에 값 존재해야 함. 확인 쿼리:
```sql
SELECT COUNT(*) FROM user_mandala_levels WHERE mandala_id = $1;  -- 9 expected
SELECT COUNT(*) FROM ontology.nodes
  WHERE (source_ref->>'table') = 'user_mandala_levels'
    AND (source_ref->>'id') IN (SELECT id::text FROM user_mandala_levels WHERE mandala_id = $1);
-- 9 expected
```

---

## Module C — Ontology migrations (trigger history)

**파일**: `prisma/migrations/ontology/*.sql`

| Mig | 내용 | 현 상태 |
|-----|------|---------|
| 001 | schema + dictionaries | ✅ active |
| 002 | core tables (ontology.nodes, ontology.edges) | ✅ |
| 003 | RLS policies | ✅ |
| 004 | `trg_sync_mandala_level` + fn `ontology.sync_mandala_level` | ✅ 유지 |
| 005 | structural_edges | ✅ |
| 006 | graph functions | ✅ |
| 007 | service/system 도메인 분리 | ✅ |
| 008 | `trg_sync_mandala`, `trg_sync_goal`, `trg_sync_topics`, `trg_sync_video_note` | 부분 유지 (video_note 만) |
| 009 | backfill edges (one-shot data migration) | ✅ |
| 010 | `trg_goal_edge`, `trg_topic_edges` | ❌ mig 011 이 삭제 |
| 011 | `DROP TRIGGER trg_goal_edge, trg_topic_edges` (Lever A) | ✅ prod 반영 (수동 apply) |
| 012 | `DROP TRIGGER trg_sync_goal, trg_sync_topics` (Lever A+) | ⏳ prod 수동 apply 대기 |

---

## Module D — Post-creation pipeline dispatcher

**파일**: `src/modules/mandala/mandala-post-creation.ts:33-100`

`setImmediate()` 내부에서 **3 track 병렬** fire-and-forget:

### D1. Main pipeline
```ts
const runId = await createPipelineRun(mandalaId, userId, trigger);
await executePipelineRun(runId);
// Steps (tracked in mandala_pipeline_runs):
//   1. ensureMandalaEmbeddings  ← Module E
//   2. runVideoDiscover          ← Module G
//   3. maybeAutoAddRecommendations ← Module H
```

### D2. Action fill
```ts
const { fillMissingActionsIfNeeded } = await import('./fill-missing-actions');
const result = await fillMissingActionsIfNeeded(mandalaId);
// ← Module F
```

### D3. Ontology edge/node sync
```ts
const { syncOntologyEdges } = await import('@/modules/ontology/sync-edges');
const result = await syncOntologyEdges(mandalaId);
// ← Module K
```

**타이밍 로그 (모두 `log.info` 로 남음)**:
- Pipeline: `Pipeline run created: {runId}` + 각 step 완료 로그
- Actions fill: `actions-fill result for mandala={id}: {action, cellsFilled}`
- Ontology: `ontology sync for mandala={id}: {ok, goalNodes, topicNodes, goalEdges, topicEdges, ms}`

**결과 도달 검증**: 3 track 모두 독립 실패 가능. 각 catch 블록에서 warn 로그. 한 track 실패가 나머지 차단 안 함.

---

## Module E — Embeddings (sub_goal level 1)

**파일**: `src/modules/mandala/ensure-mandala-embeddings.ts`

**Provider**: Mac Mini Ollama `qwen3-embedding:8b` (4096d). `embedBatch` import from `iks-scorer/embedding`.

**호출 대상**: 각 mandala 의 root.subjects[0..7] (8 sub_goal).

**SQL (idempotency check)**:
```sql
SELECT sub_goal_index, sub_goal, (embedding IS NOT NULL) AS has_embedding
FROM mandala_embeddings
WHERE mandala_id = $1 AND level = 1
```

**INSERT/UPDATE**: `mandala_embeddings` 테이블 (컬럼 `embedding vector(4096)`).

**Idempotency 전략**: 각 index 를 `ok / missing / stale` 분류. stale = sub_goal 텍스트가 현재 값과 다름 → 재생성.

**결과 도달 검증**: `SELECT COUNT(*) FROM mandala_embeddings WHERE mandala_id = $1 AND level = 1 AND embedding IS NOT NULL` = 8 expected.

---

## Module F — Action fill (LoRA → Haiku fallback)

**파일**: `src/modules/mandala/fill-missing-actions.ts:64-150`, `src/modules/mandala/generator.ts`

**상수** (fill-missing-actions.ts):
- `EXPECTED_SUB_GOAL_COUNT = 8`
- `EXPECTED_ACTIONS_PER_CELL = 8`
- `MIN_ACTIONS_TO_CONSIDER_FILLED = 8`
- `MIN_ACTION_UNIQUE_RATE = 0.7`

### F.1 LoRA (primary path since PR #450, CP416)

**호출 대상**: Mac Mini Ollama `mandala-gen:latest` (4.0B Q8_0 LoRA tuned on mandalart).

**URL**: `${MANDALA_GEN_URL}/api/generate` (env 로 주입, 예: `http://100.91.173.17:11434`)

**Request body** (generator.ts:393-410):
```json
{
  "model": "mandala-gen:latest",
  "prompt": "### Instruction:\n다음 목표에 대한 만다라트를 생성하세요: {goal}\n### Input:\n도메인: {domain}\n언어: ko\n### Output:\n",
  "stream": false,
  "keep_alive": "24h",
  "options": {
    "num_predict": 5000,
    "temperature": 0.7,
    "top_p": 0.9
  }
}
```

**Prompt 템플릿** (generator.ts:107-120, Alpaca 형식):
```
### Instruction:
다음 목표에 대한 만다라트를 생성하세요: {input.goal}
### Input:
도메인: {input.domain ?? 'general'}
언어: {lang ?? 'ko'}
### Output:
```

**파싱**: generator.ts:122~ 의 Robust JSON Parser v4.1 (Devin 5/5 pass). `fixBracketTypos` + `removeOutputField` + `escapeInnerNewlines` + `extractJsonRobust` 순차 적용.

**예상 응답 스키마**:
```json
{
  "center_goal": "...",
  "center_label": "...",
  "language": "ko",
  "domain": "general",
  "sub_goals": ["8 items"],
  "actions": { "sub_goal_1": ["8 items"], ..., "sub_goal_8": [...] }
}
```

### F.2 Haiku fallback (generator.ts:748-757)

**Provider**: `OpenRouterGenerationProvider('anthropic/claude-haiku-4.5')`.

**Prompt** (generator.ts:712-743, few-shot 포함):
```
당신은 만다라트 차트 전문가입니다. 주어진 목표에 대해 9x9 만다라트 차트를 JSON으로 생성합니다.

다음은 유사한 기존 만다라 참고 예시입니다:

{formatMandalasForFewShot(similar)  ← 과거 mandala N개를 JSON 형식으로 join}

아래 목표에 대해 새로운 만다라를 생성하세요. 반드시 아래 구조의 유효한 JSON 객체만 출력하세요:
{"center_goal": "...", "center_label": "short label", "language": "ko", "domain": "general", "sub_goals": ["8 items"], "actions": {"sub_goal_1": ["8 items per sub_goal"], ...}}

목표: {input.goal}
도메인: {domain}
언어: {lang}
```

**Request**: `provider.generate(prompt, { temperature: 0.7, maxTokens: 5000, format: 'json' })`.

### F.3 DB update (action fill 결과 반영)

**SQL** (fill-missing-actions.ts 후반부):
```ts
tx.user_mandala_levels.update({
  where: { id: levelId },
  data: { subjects: [...8 actions], subject_labels: [...labels] }
})
```

**실패 로그**: `generation_log` 테이블에 `{provider, model, status, raw_response, error}` 행 INSERT (PR #453).

**결과 도달 검증**: `SELECT array_length(subjects, 1) FROM user_mandala_levels WHERE mandala_id = $1 AND depth = 1` 의 모든 row 가 `8` 반환해야 M5 = 64/64.

---

## Module G — Video-Discover V3

**파일**: `src/skills/plugins/video-discover/v3/executor.ts:114-300`

### G.1 Preflight (114-184)

- `mandala_embeddings` level=1 확인 (존재해야 Tier 1/semantic rerank 가능)
- sub-goal texts + center_goal 로드

### G.2 환경 변수 (config.ts)

| Env | Default | 의미 |
|-----|---------|------|
| `V3_MAX_QUERIES` | 20 | LLM 생성 query 수 cap |
| `V3_TARGET_PER_CELL` | 8 | 셀당 목표 카드 수 |
| `V3_CENTER_GATE_MODE` | `'substring'` (code) → prod `semantic` (compose) | Tier 1 gate 방식 |
| `V3_ENABLE_SEMANTIC_RERANK` | false | pgvector cosine rerank (현재 off) |
| `V3_ENABLE_WHITELIST_GATE` | false | 채널 화이트리스트 적용 (off) |
| `V3_RECENCY_WEIGHT` | 상수 | 최신성 가중치 |
| `V3_PUBLISHED_AFTER_DAYS` | 1095 (3yr) | 게시일 cutoff |
| `V3_YOUTUBE_SEARCH_TIMEOUT_MS` | 1000 | 단건 search timeout |
| `V3_ENABLE_TIER1_CACHE` | false | Tier 1 pool cache 사용 여부 |

### G.3 Query 생성 (executor.ts:52-56)

```ts
buildRuleBasedQueriesSync(...)  // 규칙 기반 (center_goal + subjects 조합)
+ runLLMQueries(...)            // OpenRouter 'qwen/qwen3-30b-a3b' 로 확장
```

### G.4 YouTube search 호출

- `search.list` API (YouTube Data v3)
- key rotation: `YOUTUBE_API_KEY_SEARCH`, `_2`, `_3`
- `Promise.allSettled` + per-call timeout (PR #428)

### G.5 Tier 1 Center Gate

**Lexical 모드** (legacy, `V3_CENTER_GATE_MODE=substring`):
- video.title / description 에 center_goal 단어 substring 매칭. Korean 조사 drop 문제 있었음 (#432 subword mode 로 일부 완화).

**Semantic 모드** (`V3_CENTER_GATE_MODE=semantic`, PR #446 prod 활성):
```ts
// 의사코드 (실제 코드는 executor.ts 후반부)
const centerEmb = await embedBatch([centerGoalText]);
const videoEmbs = await embedBatch(videoTitles);
const sims = videoEmbs.map(v => cosineSimilarity(centerEmb[0], v));
// gate: sims[i] >= SEMANTIC_THRESHOLD
```

### G.6 Tier 2 Cell Assignment

- deficit cells (`have < target`) 에만 realtime search
- 각 video 를 sub_goal embedding 과 비교해 argmax cell 에 배치
- 현재 lexical (Jaccard 기반) 이 기본. **Gate 2 semantic cell 은 설계만, 미구현** (`docs/design/v3-semantic-cell-gate.md` iter 2).

### G.7 upsert recommendation_cache

```ts
upsertSlots(userId, mandalaId, slots, subGoals)
// Schema: (mandala_id, video_id, cell_index, rec_score, cell_label, keyword, source, rec_reason, published_at, ...)
// 이 INSERT 후 auto-add 가 recommendation_cache → user_video_states 로 이동
```

**Stage 계측** (executor.ts:402-436): timing, queries, perQueryCounts, poolAfterDedupe, 각 drop count (Tier 1 drop, Jaccard drop, mandala filter drop).

**결과 도달 검증**: `SELECT COUNT(*) FROM recommendation_cache WHERE mandala_id = $1` ≥ 1. M6 측정 값.

---

## Module H — Auto-add

**파일**: `src/modules/mandala/auto-add-recommendations.ts`

**Opt-in gate**: `user_skill_config` 의 `video_discover` 활성 + `config.auto_add` JSONB 체크.

**규칙**: AUTO_ADD_PER_CELL cap 은 2026-04-18 이후 제거 (PR 2d2a770). 모든 pending rec auto-add.

**SQL** (insertion):
```ts
// 추천 pool 에서 조회
recommendation_cache.findMany({
  where: { mandala_id },
  orderBy: [{ cell_index: 'asc' }, { rec_score: 'desc' }]
})
// Dedup: video_id 가 이미 user.youtube_videos 에 있으면 스킵
// Insert:
user_video_states.create({ data: { user_id, mandala_id, video_id, cell_index, auto_added: true, ... } })
```

**Eviction policy** (user가 손 안 댄 auto-added 카드):
```sql
DELETE FROM user_video_states WHERE
  user_id = $1 AND mandala_id = $2 AND cell_index = $3
  AND auto_added = true
  AND user_note IS NULL
  AND (is_watched IS NULL OR is_watched = false)
  AND (watch_position_seconds IS NULL OR watch_position_seconds = 0)
  AND is_in_ideation = false
```

**Notify**: `notifyCardAdded(mandalaId, payload)` → `cardPublisher.notify` → EventEmitter.emit (Module I 소비).

**결과 도달 검증**: `SELECT COUNT(*) FROM user_video_states WHERE mandala_id = $1 AND auto_added = true` 가 기대 수 이상.

---

## Module I — API Delivery (GET + SSE)

**파일**: `src/api/routes/mandalas.ts:1485-2270`

### I.1 GET `/api/v1/mandalas/:id/recommendations` (라인 1485-1580)

```ts
recommendation_cache.findMany({
  where: { mandala_id, user_id },
  orderBy: [{ rec_score: 'desc' }, { cell_index: 'asc' }],  // CP416 Phase A (#457)
  take: RECOMMENDATION_FETCH_LIMIT
})
```

### I.2 GET `/api/v1/mandalas/:id/videos/stream` (SSE, 라인 2121-2270)

**연결 직후 backlog emit** (라인 2213-2222, CP416 Phase B #459):
```ts
const backlog = await prisma.recommendation_cache.findMany({
  where: { mandala_id, user_id },
  orderBy: [{ rec_score: 'desc' }, { cell_index: 'asc' }],
  take: RECOMMENDATION_FETCH_LIMIT
});
for (const row of backlog) {
  sendEvent({ type: 'card_added', payload: toCardPayload(row) });
}
```

**Live subscribe** (라인 2244):
```ts
const unsubscribe = cardPublisher.subscribe(mandalaId, (payload) => {
  sendEvent({ type: 'card_added', payload });
});
```

**Heartbeat**: 20초마다 `event: ping`.

**Payload 스키마** (라인 2225-2239):
```ts
interface CardPayload {
  id, videoId, title, channel, thumbnail, durationSec, recScore,
  cellIndex, cellLabel, keyword, source, recReason
}
```

**결과 도달 검증**: 클라이언트 EventSource 에서 연결 직후 N개 backlog card 수신 → 이후 live 추가 수신. 서버 측 로그 `SSE backlog emitted={N}`.

---

## Module J — Frontend merge + sort

**파일**: `frontend/src/features/recommendation-feed/model/useVideoStream.ts:53-200`

**연결**:
```ts
const es = new EventSource(
  `${API_BASE_URL}/api/v1/mandalas/${mandalaId}/videos/stream?access_token=${token}`
);
```

**Binary insert** (라인 179-199):
```ts
function insertByScoreDesc(list, item) {
  const s = item.recScore;
  let lo = 0, hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (list[mid].recScore < s) hi = mid;
    else lo = mid + 1;
  }
  return [...list.slice(0, lo), item, ...list.slice(lo)];
}
```

**호출**: `setCards(prev => insertByScoreDesc(prev, payload))` (라인 134).

**RecommendationFeed 측 전역 재정렬** (CP416 Phase B): 
- 기존 로컬 카드 + SSE 수신 카드 merge 후 `recScore desc` 전역 재정렬 (`frontend/src/features/recommendation-feed/ui/RecommendationFeed.tsx`).

**결과 도달 검증**: `cards` 배열이 `recScore DESC` 정렬 유지. FE dev tool / redux devtools 로 확인.

---

## Module K — sync-edges (Lever A/A+)

**파일**: `src/modules/ontology/sync-edges.ts:63-343`

4단계 multi-row SQL (모든 INSERT `ON CONFLICT DO NOTHING` 또는 `DO UPDATE`):

### K.1 Goal nodes upsert (라인 141-162)
```sql
INSERT INTO ontology.nodes (user_id, type, title, properties, source_ref)
SELECT ${userId}::uuid, 'goal', t,
       jsonb_build_object('level_key', lk, 'depth', d::int, 'mandala_id', mid::uuid),
       jsonb_build_object('table', 'user_mandala_levels_goal', 'id', rid)
  FROM unnest(${titles}::text[], ${levelKeys}::text[], ${depths}::int[],
              ${mandalaIds}::text[], ${refIds}::text[]) AS u(t, lk, d, mid, rid)
ON CONFLICT ((source_ref->>'table'), (source_ref->>'id'))
  WHERE source_ref IS NOT NULL
DO UPDATE SET title=EXCLUDED.title, properties=EXCLUDED.properties, updated_at=now()
```

### K.2 Topic nodes upsert (라인 189-219)

동일 패턴, `type='topic'`, source_ref.id = `"{level-id}:{subject}"`.

### K.3 Goal edges (라인 303-312)
```sql
INSERT INTO ontology.edges (user_id, source_id, target_id, relation)
SELECT ${userId}::uuid, s::uuid, t::uuid, 'CONTAINS'
  FROM unnest(${sources}::text[], ${targets}::text[]) AS u(s, t)
ON CONFLICT (source_id, target_id, relation) DO NOTHING
```
`source = sector node`, `target = goal node`.

### K.4 Topic edges (라인 315-325)

동일 패턴, `target = topic node`.

**결과 도달 검증**:
```sql
SELECT (SELECT COUNT(*) FROM ontology.nodes n WHERE n.source_ref->>'id' LIKE '<mandala-id>%' AND n.type='goal') AS goals,
       (SELECT COUNT(*) FROM ontology.nodes n WHERE n.type='topic' AND n.properties->>'mandala_id' = '<mandala-id>') AS topics,
       (SELECT COUNT(*) FROM ontology.edges e JOIN ontology.nodes s ON s.id = e.source_id WHERE s.properties->>'mandala_id' = '<mandala-id>' AND e.relation='CONTAINS') AS edges;
```

---

## Timing measurement reference

모든 측정은 `[mandala-create-timing]` 접두사 로그로 prod 수집. 조회:
```bash
ssh insighta-ec2 "docker logs <api-container> 2>&1 | grep 'mandala-create-timing' | tail -20"
```

| Metric | 로그 라벨 | 파일:라인 | 현 baseline (CP416) | Target (서비스 선) |
|--------|-----------|-----------|---------------------|--------------------|
| M7 | `tx_levels_createMany` | manager.ts:428 | 6.9s (Lever A 전) → 5.1s (Lever A 후) → **측정 대기 (Lever A+ 후)** | <1s |
| M1 | (사용자 체감) | — | 7s | ≤1s |
| M2 | (사용자 체감) | — | 21s | ≤4s |
| M3 | (사용자 체감) | — | 60s+ | 즉시 |
| M5 | `actions-fill result` `cellsFilled` | mandala-post-creation.ts:64 | 간헐 (6/8, 0/8) | 64/64 |
| M6 | `SELECT count(*) from recommendation_cache` | — | 19 | 50+ |
| M8 | V3 stage observability (Tier 1 drop rate) | executor.ts:402-436 | 73% (lexical) → 개선 (semantic, 수치 미관찰) | <30% |
| M9 | Jaccard/cell drop (Tier 2) | 동일 | 44 drop | ~12 |

---

## Update protocol

이 파일은 **실제 구현 스냅샷**. 실험 시도/결과는 `wizard-dashboard-perf-log.md` 쪽.

- 새 모듈 추가 / 기존 모듈 재설계 시 해당 섹션 업데이트.
- 환경 변수 / 상수 값 변경 시 표 갱신.
- 트리거 drop/create 시 Module C 표 + Module B "현재 살아있는 DB 트리거" 갱신.
- Prompt 템플릿 변경 시 Module F 전문 교체.
- SQL 변경 시 해당 모듈 블록 교체.

Cross-ref:
- 실험 ledger: `docs/reports/wizard-dashboard-perf-log.md`
- 설계 문서: `docs/design/wizard-service-redesign-2026-04-22.md`, `docs/design/v3-semantic-cell-gate.md`, `docs/design/card-refresh-strategy.md`, `docs/design/progressive-relevance-stream.md`
- 마이그레이션: `prisma/migrations/ontology/*.sql`
