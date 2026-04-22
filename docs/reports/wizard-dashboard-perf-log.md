# Wizard → Dashboard Performance Experiments Log

**Purpose**: 위저드 저장 → 대시보드 카드 노출 e2e 체감 지연 회복 작업의 **running ledger**. 새 실험 착수 / 실측 결과 확인 / 롤백 시 반드시 이 파일을 먼저 업데이트. 한 번의 정리 문서가 아니라 지속 관리 대상.

**Owner**: 위저드-대시보드 성능 arc 에 직접 commit 하는 세션이 갱신 책임. 최소 CP 단위 갱신.

**Last updated**: 2026-04-22 (CP416 말, PR #462 merged)

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

| Metric | CP388 기점 (2026-04-15) | CP416 중반 (user 보고, 2026-04-22 아침) |
|--------|-------------------------|----------------------------------------|
| M1 | 측정 안 됨 | 7s |
| M2 | 측정 안 됨 | 21s |
| M3 | 대기 지속 | 60s+ (사용자 판단 "서비스 불가") |
| M4 | 미도달 | 미도달 ("2 cards 현상", 최대 19) |
| M5 | 부분 성공 | 간헐 실패 (LoRA silent fail) |
| M6 | 2~19 | 2~19 |
| M7 | n/a | 6.9s (PR #449 직후) |
| M8 | ~73% drop (lexical) | (Phase 3 semantic 전까지 유지) |

**Target (서비스 가능 선)**: M1 ≤ 1s / M2 ≤ 4s / M3 즉시 / M4 수 초 / M5 64/64 / M6 50+ / M7 < 1s.

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
| 2026-04-22 | #462 | **Lever A+**: `trg_sync_goal` / `trg_sync_topics` drop + node upsert 앱레이어화 | 117 queries → 18 queries | M7 < 1s | **측정 대기** (Deploy 진행 중, merged `bd2651b`) | ⏳ |

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

---

## Current state (2026-04-22 end of CP416)

**Prod live**:
- Phase 3 semantic center gate (#446/448) — `printenv=semantic` 실측
- Phase A relevance-first sort (#457)
- Phase B SSE backlog (#459)
- Phase C atomic default mandala (#460)
- Lever A edge trigger defer (#456) — prod DROP TRIGGER 완료
- Action-fill LoRA primary (#450~453)
- LoRA NUM_PREDICT 5000 (#452)

**Deploy in flight**:
- Lever A+ (#462) — node 트리거 drop + 앱레이어 upsert. Post-deploy 수동 DROP + M7 측정 필요.

**M1~M9 실측 후 업데이트 대상** (이 섹션은 Deploy 완료 + 사용자 재측정 시 갱신):
- M1 (템플릿): 예상 7s → ~1s
- M2 (AI custom): 예상 21s → 3~4s
- M3 (첫 카드): 예상 60s+ → 즉시 (backlog)
- M4 (24 카드): 수 초
- M6 (pool): 여전히 19 (Layer 2 gate 2 미적용)

---

## Outstanding hypotheses (CP417+)

| # | Hypothesis | Layer | Expected lever | Design status |
|---|------------|-------|----------------|---------------|
| H1 | Gate 2 semantic cell assignment 으로 M6 19→50+ | L2 | `docs/design/v3-semantic-cell-gate.md` iter 2 | ready, option (a)/(b)/(c) 결정 대기 |
| H2 | LoRA direct-call JSON parse error 해소로 M5 62/64 → 64/64 | L3 | `generation_log` valid/invalid diff | 착수 전 |
| H3 | DB INSERT 추가 튜닝 (M7 Lever A+ 실측 후 잔여 bottleneck 분석) | L4 | pending M7 실측 | 측정 대기 |
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

## Cross-references

- Design docs: `docs/design/wizard-dashboard-redesign-2026-04-21.md`, `docs/design/wizard-service-redesign-2026-04-22.md`, `docs/design/v3-semantic-center-gate.md`, `docs/design/v3-semantic-cell-gate.md`, `docs/design/card-refresh-strategy.md`, `docs/design/progressive-relevance-stream.md`
- Related migrations: `prisma/migrations/ontology/011_drop_goal_topic_edge_triggers.sql` (Lever A), `prisma/migrations/ontology/012_drop_goal_topic_node_triggers.sql` (Lever A+)
- Memory: `~/.claude/projects/-Users-jeonhokim-cursor-insighta/memory/checkpoint.md` (CP388~CP416), `work-efficiency.md`, `architecture.md`, `troubleshooting.md`
