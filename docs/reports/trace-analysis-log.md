# Video-Discover Trace Analysis Log

> 사후 분석용 누적 기록. 각 만다라 1 섹션. 측정값·관찰만, 추론 별도 표기.
>
> 소스: `video_discover_traces` 테이블 (CP457+ instrumentation, `V3_TRACE_ENABLED=true`).
>
> 분석 절차: trace JSON + recommendation_cache + user_video_states + skill_config 의 4-source 결합.

---

## 2026-05-14 14:14 KST — "AI 마케팅 으로 비즈니스 성장 시키기"

### Identity
| 항목 | 값 |
|------|-----|
| mandala_id | `8a272317-af34-4678-933a-03dba6ec008c` |
| user_id | `0192fedf-85f4-47ab-a652-7fdd116e2b39` |
| run_id | `0756728e-146a-45b4-bc4c-0c3fc55accb1` |
| created_at | 2026-05-14T05:14:05.749Z (KST 14:14:05) |
| title | "AI 마케팅 으로 비즈니스 성장 시키기" |
| sub_goals | 8개 — AI 마케팅 도구 및 플랫폼 학습 / 마케팅 자동화 시스템 구축 / AI 기반 고객 분석 및 세분화 / 콘텐츠 생성 및 최적화 프로세스 개발 / AI 채널별 캠페인 전략 수립 / 데이터 기반 성과 측정 및 개선 / 팀 역량 강화 및 교육 / AI 마케팅 예산 효율화 |
| focus_tags | 1개 — SaaS 비즈니스 |
| skill_config | `{ enabled: true, config: { auto_add: true } }` |

### Pipeline trace (chronological, 20 rows / 1 run / 0 errors)

```
시각              step                                 status  latency
14:14:18.917      pipeline.execute.start               ok          0ms
14:14:41.013      embed.batch                          ok       6771ms  ← center + Tier 1 후보 30 titles
14:14:41.714 ~ 42.203  tier2.search.list × 9           ok    705~1191ms  ← rule-based queries (parallel)
14:14:42.908      tier2.keyword_builder.llm            ok       1909ms  ← LLM (anthropic/claude-haiku-4.5)
14:14:43.362 ~ 43.533  tier2.search.list × 5           ok     455~614ms  ← LLM-generated queries
14:14:44.096      tier2.videos.batch                   ok        565ms  ← videos.list (duration/views/ stats)
14:14:46.214      embed.batch                          ok       2099ms  ← center + Tier 2 후보 30 titles
14:14:46.480      hybrid_rerank.cohere                 ok        173ms  ← Cohere rerank-multilingual-v3.0
```

총 **27.5초** (start → cohere). 그 뒤 mandala_filter / auto_add 흐름은 **본 트레이스 instrumentation 누락** — 다음 PR 에서 추가.

### LLM keyword_builder — full payload

**Model**: `anthropic/claude-haiku-4.5` (OpenRouter wrapper 추정 — 모델명 prefix `anthropic/`)
**Temperature / max_tokens**: trace 캡처됨 (별도)
**Prompt 발췌** (full prompt 는 trace JSON 의 request.prompt):
- header: `YouTube에서 "AI 마케팅 으로 비즈니스 성장 시키기" 목표 중 "SaaS 비즈니스, 팀 역량 강화 및 교육, AI 마케팅 예산 효율화" 영역의 학습 영상을 찾아야 합니다.`
- 8 sub_goals 중 **3개만** prompt 에 주입 (focus tag + 2 sub_goals).
- 검색어 구성 공식: `{중심목표 핵심어 1-2개} + {세부영역 핵심어 1-2개}`, 12-20자, JSON 배열만 출력.

**Raw response** (JSON inside markdown fence):
```json
[
  "SaaS 마케팅 AI 자동화",
  "AI 마케팅 팀 교육 가이드",
  "SaaS 성장 예산 효율화",
  "AI 마케팅 실수 방지법",
  "SaaS 비즈니스 AI 도구 추천"
]
```
`parsed_query_count: 5` / cap=5.

### YouTube search.list — 14 queries

| # | query | region | order | item_count | 평가 |
|---|-------|--------|-------|------------|------|
| 1 | `AI 마케팅 으로 비즈니스 성장 시키기 콘텐츠 생성` | KR | viewCount | 4 | rule, 너무 길어 매칭 적음 |
| 2 | `... 팀 역량` | KR | — | 50 | rule |
| 3 | `... 데이터 기반` | KR | — | 50 | rule |
| 4 | `... AI 마케팅` | KR | viewCount | 50 | rule (중복 키워드) |
| 5 | `AI 마케팅 으로 비즈니스 성장 시키기` (centerGoal only) | KR | — | 47 | rule |
| 6 | `... SaaS 비즈니스` | KR | — | 45 | rule |
| 7 | `... 마케팅 자동화` | KR | date | 32 | rule |
| 8 | `... AI 채널별` | KR | — | 50 | rule, 문맥 손실 |
| 9 | `... AI 기반` | KR | — | 49 | rule |
| 10 | `SaaS 성장 예산 효율화` | KR | — | 19 | LLM |
| 11 | `SaaS 비즈니스 AI 도구 추천` | KR | date | 17 | LLM |
| 12 | `AI 마케팅 실수 방지법` | KR | viewCount | **0** | **LLM, 결과 없음 — quota 낭비** |
| 13 | `SaaS 마케팅 AI 자동화` | KR | — | 45 | LLM |
| 14 | `AI 마케팅 팀 교육 가이드` | KR | — | 50 | LLM |

총 **14 calls × 100 units = 1400 quota units** 소모.
누적 item: 508 (중복 포함 추정).

### embed.batch — 2회

| # | latency | text_count | dim | 입력 (첫 텍스트) |
|---|---------|-----------|-----|------------------|
| 1 | 6771ms | 31 | 4096 | "AI 마케팅 으로 비즈니스 성장 시키기" (center + 30 Tier 1 titles) |
| 2 | 2099ms | 31 | 4096 | "AI 마케팅 으로 비즈니스 성장 시키기" (center + 30 Tier 2 titles) |

Tier 1 (#1) 의 후보 titles 에 "엔비디아 랠리", "Self Study Plan With ChatGPT", "Learn Faster with AI Knowledge Graph in Obsidian" 등 **AI 일반** 카테고리 영상 포함 — Tier 1 video_pool 의 cosine threshold 가 마케팅·비즈니스 도메인을 충분히 좁히지 못함.

### hybrid_rerank.cohere — payload

| 항목 | 값 |
|------|-----|
| model | `rerank-multilingual-v3.0` |
| query | `AI 마케팅 으로 비즈니스 성장 시키기` |
| document_count | 63 |
| top_n | **96** (>= document_count, 비정상) |
| billed_units | `{ search_units: 1 }` |
| relevance_score 분포 | **63 rows 전부 0.0000** |

→ Cohere API 호출은 성공 (200 OK, 1 unit 빌링) 했으나 **모든 score 가 0**. 후보:
1. `documents` payload 에 HTML entity (`&quot;`, `&#39;`, `&amp;`) 미decoded 로 전달 → 모델이 의미 추출 실패
2. `top_n` 이 `documents.length` 보다 크면 Cohere 가 empty score 로 채울 가능성 (spec 확인 필요)
3. Cohere response 파싱 시 field 이름 mismatch (e.g. `relevance_score` vs `score`)

→ **rerank 사실상 무력화** = 최종 47장 정렬이 fallback 경로 (rec_score, recency) 로만 결정됨.

### 최종 DB 상태

| 항목 | 값 |
|------|-----|
| recommendation_cache rows | 60 |
| user_video_states rows | 47 |
| Cell 0 | 20 cards |
| Cell 1 | 11 cards |
| Cell 2 | 4 cards |
| Cell 3 | **0** |
| Cell 4 | **0** |
| Cell 5 | **0** |
| Cell 6 | **0** |
| Cell 7 | 12 cards |

→ 8 cell 중 **4 cell empty**. mandala_filter 의 cell assignment (jaccard) 가 sub_goal 토큰과 후보 title 토큰 간 overlap 을 4개 cell 분량만 산출.

### 카드 품질 — eyeball (Cell 0 sample)

| 분류 | 카드 수 | 예시 |
|------|--------|------|
| ✅ On-topic (AI 마케팅 / 디지털 마케팅 / 비즈니스) | ~12 | "마케팅 천재 킷캣의 AI 활용법" / "구글 AI 디자이너 마케터 포멜리" |
| ❌ Off-topic (AI 일반 / 자기계발 / 주식) | ~6 | "엔비디아 랠리 1년 더?" / "ULTIMATE Self Study Plan With ChatGPT" / "[김현석 월스트리트나우]" |
| ⚠️ 모호 | ~2 | "미국 성장주 추천" |

### Anomalies (정리)

1. **🚨 Cohere rerank score 0.0000 (63 rows 전부)** — rerank 무력화.
2. **⚠️ Cell 3·4·5·6 = 0 cards** — mandala_filter cell assignment 가 half mandala 만 채움.
3. **⚠️ top_n=96 > document_count=63** — Cohere 입력 비정상.
4. **⚠️ Query `AI 마케팅 실수 방지법` item_count=0** — LLM 쿼리 1개 무의미.
5. **⚠️ LLM prompt 가 sub_goals 8개 중 3개만 사용** — 5개 sub_goal 미반영.
6. **⚠️ Tier 1 video_pool 후보 (embed#1 입력)** 에 마케팅 무관 일반 AI 영상 포함.

### 누락 capture (다음 PR 에서 instrument 추가)

- `tier1.match_from_video_pool` — cache-matcher.ts:130
- `tier1.match_by_center_goal` — cache-matcher.ts:230-ish
- `hybrid_rerank.tsvector_keyword` — hybrid-rerank.ts:223
- `mandala_filter.semantic_gate` — executor.ts 3 caller sites
- `auto_add.user_video_states` — auto-add-recommendations.ts:364

---
