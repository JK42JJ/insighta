# Design — video_pool Growth Loop (Phase 3B, SLO-2 pool 축 선행)

**Date**: 2026-04-23 (rewritten after CP417 diagnostic)
**Owner**: CP417+
**Status**: DRAFT — schedule-flip PR opened; dedicated-key follow-up pending

---

## 핵심 목표 (1줄)

`video_pool` 을 현재 1,164 → 단기 **10k**, 장기 **100k+** 로 **매일 유의미한 growth** 로 성장시킨다.

## 본질 (1줄)

인프라는 이미 있다 — GHA cron + internal endpoint + skill executor + runs 관측 테이블. **문제는 실행 결과가 quota exhaustion 으로 0 videos_new 를 반복** 하고 있다는 점. 구축이 아니라 **진단 기반 운영 복구**.

## 컨셉 (1줄)

**cron 시간대를 YouTube quota reset 직후로 옮긴다**. 그 외 변경 없음. 효과는 다음 7일간 `videos_new` 추이로 검증.

---

## 진단 근거 (CP417 실측, 2026-04-23)

### 확인된 기존 인프라

| 자원 | 위치 | 상태 |
|------|------|------|
| GHA workflow | `.github/workflows/batch-video-collector.yml` | 존재, cron 설정됨 |
| Internal endpoint | `POST /api/v1/internal/skills/batch-video-collector/run` | 존재, INTERNAL_BATCH_TOKEN 인증 |
| Skill executor | `src/skills/plugins/batch-video-collector/executor.ts` (544 lines) | 완성 — trend keywords 기반 (channel whitelist 아님) |
| Run 관측 테이블 | `public.video_pool_collection_runs` | 존재 — 11 rows 누적, `started_at / status / videos_new / quota_used / error` 컬럼 |

### 최근 10 runs 실측 (schedule 이전)

| 날짜 (UTC) | status | videos_new | quota_used | 비고 |
|------------|--------|-----------|-----------|------|
| 04-22 06:04 | failed | **0** | 0 | quota exhausted before any fetch |
| 04-21 06:07 | success | 140 | 6035 | ✅ 유일하게 의미있는 run |
| 04-20 06:22 | partial | 0 | 5100 | mid-run exhaust |
| 04-19 06:03 | partial | 0 | 2100 | mid-run |
| 04-18 05:44 | partial | 0 | 100 | 거의 즉시 exhaust |
| 04-17 06:08 | failed | 0 | 0 | immediate |
| 04-16 06:07 | partial | 0 | 200 | mid-run |
| 04-15 07:51/46/40 | 2 success + 1 partial | 82 + 942 | ~12k | 수동 재시도 3건 |

**7일 growth**: ~1,164 rows. 대부분 04-15 + 04-21 에서 누적.

### Root cause (확정)

1. **key 공유**: `batch-video-collector` 는 `YOUTUBE_API_KEY_SEARCH` (executor.ts:109) **단일 key** 사용. v3 discover 는 `_SEARCH + _2 + _3` 세 개를 rotation 으로 사용 — **하지만 같은 Google Cloud 프로젝트 혹은 순차 exhaust 시 `_SEARCH` 를 먼저 태움**.
2. **schedule mis-timing**: cron `0 4 * * *` = 04:00 UTC = PT 20:00 (PDT 21:00). YouTube quota reset = **00:00 PT (= 07:00 UTC PDT)** → batch 가 **reset 3시간 전** 에 실행 → 전날 사용자 v3 트래픽이 먹고 남은 quota 로 동작.

---

## 수정 범위

### 본 PR (이번 이슈)

**1 change only**: `.github/workflows/batch-video-collector.yml`
- `cron: '0 4 * * *'` → `cron: '30 7 * * *'`
- 해석: 07:30 UTC = 00:30 PT (PDT quota reset 직후 30분) = 16:30 KST
- 30분 buffer 는 Google Cloud quota reset lag 대비

**기대 효과**:
- batch 가 **fresh 10k quota** 전액 사용 가능
- 현 executor 기준: 1 run ≈ 60 queries × 100 max_results ≈ 6,000 units, **1,000~2,000 videos_new 기대**
- 1주일 후 `video_pool` 누적 ≥ 10k 가능 (per-run 1,500 × 7 days 가정)

### Out of scope (별도 follow-up)

1. **Dedicated API key** — `YOUTUBE_API_KEY_BATCH` 별도 Google Cloud 프로젝트 발급 → 10k 독립 quota
   - 사용자 GCP 콘솔 작업 필요 (CC 범위 외)
   - schedule flip 만으로 충분한지 1주일 관측 후 결정
2. **Failure observability** — 3 consecutive fail 시 GitHub issue 자동 생성
   - nice-to-have; `video_pool_collection_runs` 테이블 SQL 쿼리로도 충분 관측 가능
3. **Channel whitelist 기반 수집** (기존 설계 doc 의 제안)
   - 현 executor 는 trend keywords 기반 — 다른 접근. 도입하려면 대규모 재설계 필요
   - 검증 전제: trend keywords 방식이 growth rate 한계에 도달하는지 1주일 관측

---

## Readiness gate (Phase 3A 진입 조건)

다음 3개 전부 충족 시 Phase 3A (Tier 1 재활성) 검토:

1. `SELECT COUNT(*) FROM video_pool` ≥ **10,000** (현 1,164 의 8.6배)
2. KNN top-60 precision ≥ 50% (샘플 mandala 10건 수동 QA)
3. embedding 누락률 < 5% (`video_pool_embeddings / video_pool`)

예상 도달: schedule flip 후 **1주일** (1~2k rows/day × 7).

---

## 측정 / Rollback

### 일일 관측 쿼리

```sql
-- 최근 14 days growth
SELECT DATE(cached_at) AS day, COUNT(*) AS added
  FROM public.video_pool
 WHERE cached_at > NOW() - INTERVAL '14 days'
 GROUP BY 1 ORDER BY 1 DESC;

-- 최근 runs 효율
SELECT started_at, status, videos_new, quota_used, error
  FROM public.video_pool_collection_runs
 ORDER BY started_at DESC LIMIT 10;
```

### 1주일 후 판정

- **Success**: 평균 `videos_new ≥ 500` per day → schedule flip 단독으로 충분
- **Partial**: `videos_new` 변동성 큼 (200~1500) → follow-up: dedicated key
- **Fail**: 여전히 `videos_new ≈ 0` 지속 → 다른 quota consumer 발견 필요 (v3 가 새벽에 돌리는 auto-add 등)

### Rollback

GHA workflow 1-line revert (`cron` 값 복원). 이전 schedule 로 즉시 복귀. 다른 state 변경 없음.

---

## Non-goals

- 신규 테이블 (이미 `video_pool_collection_runs` 있음)
- 신규 endpoint (이미 internal skill endpoint 있음)
- Channel whitelist / `playlistItems.list` 도입 (별도 track, 결정 데이터 부족)
- pg_cron / 별도 worker (GHA 로 충분)
