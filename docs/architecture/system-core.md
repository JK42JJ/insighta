# Insighta System Core — Canonical Architecture

> **Date**: 2026-04-24 (CP425 4-layer defense L1)
> **Purpose**: 위저드-대시보드 전체 파이프라인 단일 진실원. 부분 최적화 전 반드시 여기 매핑 확인.
> **Status**: CANONICAL — 변경은 PR + `/retro` 승인 필수.

---

## Core Philosophy (절대 규칙)

### 원칙 1 — 양질의 데이터 × 최소 latency 는 분리 불가

한 축만 개선하는 작업은 **regression 리스크**.

- latency 만 올리기: 저품질 카드를 빠르게 보여줌 → 사용자 체감 악화
- quality 만 올리기: 느리면 사용자가 결과를 안 봄 → 체감 동일
- **동시 개선만 유의미한 개선**

### 원칙 2 — Canonical path 우선

새로운 cache/table/path 생성 전 **canonical 확장 가능성** 을 먼저 검증.

- canonical 이 부족한 이유가 "구조적 한계" 인지 "운영 실패" 인지 구분
- 운영 실패 (pool 1,164 → 10k 목표) 를 "canonical 은 부족하다" 로 오해하고 parallel path 만들면 → fragmentation + 유지 비용 ↑
- **parallel path 허용 조건**: 구조적 한계 증명 + TTL/수렴 계획 명시

---

## 전체 Dataflow (1 diagram)

```
[Source]
  ├─ YouTube Data API (quota 10k units/day, YOUTUBE_API_KEY_SEARCH)
  │     ▼
  │   EC2 batch-video-collector (GHA cron 07:30 UTC)
  │     ▼
  │   video_pool (현재 1,164 → 10k → 100k target)
  │
  └─ yt-dlp + WebShare proxy (Mac Mini, no quota)
        ▼
      video_chunk_embeddings (2,641 chunks, 별도 pipeline)
        ※ video_pool 과 video_id overlap = 0 (미통합)

[Staging]
  video_pool ──┬─▶ video_pool_embeddings (BGE-M3 1024d, pgvector ivfflat)
               └─▶ video_pool_domain_tags (도메인 9종, relevance_score)

[Quality Signals]
  ├─ quality_tier (view_count 기반: gold ≥100K / silver ≥10K / bronze ≥1K)
  ├─ quality_gate (PR #463, Tier 2 insertion 전 filter)
  └─ rich_summary (Issue #417 → PR #472, CP422+)
        ※ 현재 FE consumer 0 — 품질 신호로 아직 미활용

[Serving]
  V3 executor (src/skills/plugins/video-discover/v3/executor.ts)
  ├─ Tier 1: pgvector KNN on video_pool (bronze 제외)
  ├─ Tier 2: 부족분 YouTube Search realtime + embed + upsert back to pool
  └─ Tier 3: LoRA 백그라운드 보강 (LoRA v14 대기)

[Cache]
  recommendation_cache (유저별 × 만다라별 추천 결과, persistent)
        ▼
  user_video_states (유저 카드 상태, UI 소스)

[Delivery]
  cardPublisher ──▶ SSE backlog ──▶ Dashboard 첫 카드 표시

[Ephemeral Shortcut — NEW CP424.2]
  mandala_wizard_precompute (session_id PK, TTL 10min, pg_cron sweep)
        ※ Step 1 → discover 선제 실행 → Step 3 save 시 recommendation_cache 로 이전
        ※ Canonical 을 대체하지 않음. miss 시 canonical fallback.
```

---

## Canonical vs Legacy / Shortcut Module Map

| Layer | Canonical (유지·확장 대상) | Legacy / Shortcut (주의·수렴) |
|-------|--------------------------|------------------------------|
| Source | `video_pool` (YouTube Data API) | `video_chunk_embeddings` (yt-dlp Mac Mini) — 미통합, 별도 pipeline |
| Staging | `video_pool_embeddings`, `video_pool_domain_tags` | — |
| Quality | `quality_tier`, `quality_gate`, `rich_summary` | `rich_summary` FE consumer 미구현 (Issue #417 P1 미완) |
| Serving | `v3 executor Tier 1→2→3` | `generateMandalaRace` (pre-CP415 패턴, 사용 중단) |
| Cache | `recommendation_cache` (유저 × 만다라) | `mandala_wizard_precompute` (**session shortcut**, CP424.2) |
| Delivery | `cardPublisher` + SSE | — |

### Shortcut 승격 조건

`mandala_wizard_precompute` 는 SLO-1 (대시보드 첫 카드 ≤1s) 체감을 위한 shortcut.

- **생존 조건**: miss rate < 20%, consumed/pending 비율 > 0.8
- **수렴 계획**: canonical recommendation_cache 가 pool 10k+ 도달 후 warm-cache 로 동일 SLO 달성하면 **제거 검토**
- **moniter SQL**:
  ```sql
  SELECT status, COUNT(*) FROM mandala_wizard_precompute
  WHERE created_at > NOW() - INTERVAL '1 day' GROUP BY status;
  ```

---

## Quality Signal Pipeline

```
영상 메타 수집 (view_count, duration, language)
     │
     ▼
quality_tier 분류 (gold/silver/bronze, video_pool 컬럼)
     │
     ▼
BGE-M3 임베딩 생성 (video_pool_embeddings)
     │
     ▼
도메인 태깅 (video_pool_domain_tags, 검색어 도메인 기반)
     │
     ▼
[옵션] rich_summary 생성 (LLM, Issue #417) — 아직 ranking 미반영
     │
     ▼
V3 executor KNN 매칭 시점 pre-filter
  ├─ quality_tier ≠ bronze
  ├─ quality_gate PASS (PR #463)
  └─ cosine_sim ≥ 0.3
```

**현재 gap**:
- rich_summary 가 생성되지만 v3 ranking 에 기여 안 함 → **FE/ranking consumer 필요**
- quality_gate A/B baseline 1주 수집 후 full-rollout 결정 대기

---

## 변경 전 5-axis 감사 체크리스트

Pipeline 관련 PR 제출 전 **반드시 5개 축 모두 답해야** 함 (L3 `memory/feedback_plan_before_execute.md` 와 cross-ref).

1. **Upstream source** — 어떤 API/스크래퍼가 이 데이터를 feed 하나?
   - 예: YouTube Data API (quota) / yt-dlp (no quota) / 유저 입력
2. **Staging layer** — 임베딩/태깅/변환이 어디서 끝나나?
   - 예: `video_pool_embeddings` BGE-M3 완료 후 KNN 가능
3. **Quality signal** — 어떤 신호가 이 데이터의 품질을 측정하나?
   - 예: quality_tier / quality_gate / rich_summary / user thumbs-up
4. **Caching** — 결과가 어느 cache 로 흐르나?
   - 예: recommendation_cache (persistent) / wizard_precompute (ephemeral 10min)
5. **Serving** — 어떤 executor 가 end-user 에게 serve 하나?
   - 예: v3 Tier 1/2/3 / cardPublisher SSE / Dashboard hook

### Canonical Extension 체크리스트

새 table/cache 제안 시:

- [ ] 기존 canonical 로 해결 불가 이유가 **구조적** 인가 **운영** 인가?
- [ ] canonical path 와 duplicate 하는 데이터가 있는가?
- [ ] 있다면 TTL 또는 수렴 계획이 명시되어 있는가?
- [ ] 이 shortcut 이 legacy 로 남지 않는 조건은 무엇인가?

체크리스트 4개 전부 YES + 이 문서 §"Canonical vs Legacy Module Map" 에 legacy row 추가 **후에만** 신규 path 머지.

---

## 핵심 SSOT 참조

| 문서 | 역할 |
|------|------|
| `docs/design/insighta-video-cache-layer-design.md` | `video_pool` 3-tier 스펙 + 배치 수집 파이프라인 + 절대 규칙 |
| `docs/design/video-pool-growth.md` | 1,164 → 10k → 100k 진행 + schedule flip (PT quota reset) |
| `docs/design/precompute-pipeline.md` | Wizard ephemeral shortcut 근거 (session_id TTL 10min) |
| `docs/design/quality-gate.md` | Tier 2 quality gate + A/B baseline |
| `docs/design/realtime-search-pipeline.md` | Phase 3A Tier 1 재활성 + semantic v2 |

---

## 금지 패턴 (Anti-patterns)

- **부분 최적화**: latency 만 줄이고 quality 검증 없이 ship (CP424.2 precompute 는 필수 guard 통과 — poll-wait + miss fallback)
- **Parallel cache 남발**: canonical 부족의 원인이 "운영" (pool 규모 부족) 일 때 new table 로 우회
- **Quality signal 저장소 분리**: rich_summary 를 별도 service 로 만드는 등 — canonical table column 으로 유지
- **SSOT 무시**: 이 문서 + §참조 design doc 미확인 상태에서 pipeline 코드 수정

---

## 변경 이력

- 2026-04-24 (CP425): 초안. CP424.2 wizard precompute ship 후 "canonical path 우선" 원칙 공식화.
