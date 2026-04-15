# Insighta Video Cache Layer 설계 — CC 핸드오프

> 날짜: 2026-04-15
> 목적: YouTube API 실시간 호출 의존에서 벗어나 사전 캐시 기반 즉시 응답 구조로 전환
> 관련: insighta-video-discover-3tier-handoff.md, insighta-trend-recommendation-engine.md

---

## 1. 왜 별도 캐시 레이어가 필요한가

현재 `recommendation_cache`는 유저별/만다라별 추천 결과를 저장하는 테이블.
이건 **결과 캐시**이지 **영상 풀 캐시**가 아님.

필요한 건:
- **도메인별 고품질 영상 풀** — 유저 요청 전에 이미 수집·검증·임베딩 완료
- **유저 요청 시 DB 매칭만** — YouTube API 호출 0회, 1-2초 응답
- **실시간 보충은 fallback** — 캐시 미스 시에만 API 호출

```
기존: 유저 요청 → YouTube API → 스코어링 → 저장 → 표시 (12초)
변경: 배치 수집 → 캐시 축적 → 유저 요청 → DB 매칭 → 표시 (1-2초)
```

---

## 2. 캐시 레이어 구조

```
┌─────────────────────────────────────────────────────┐
│                    video_pool                        │
│  (영상 마스터 — 한 번 수집하면 재사용)                  │
│  video_id PK, title, description, channel,           │
│  view_count, duration, published_at, language,       │
│  thumbnail_url, cached_at, expires_at                │
└──────────────────────┬──────────────────────────────┘
                       │ 1:N
┌──────────────────────▼──────────────────────────────┐
│                video_pool_embeddings                 │
│  (영상별 임베딩 — BGE-M3 1024d)                      │
│  video_id FK, embedding vector(1024),                │
│  model_version, created_at                           │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│              video_pool_domain_tags                  │
│  (영상-도메인 매핑 — 하나의 영상이 여러 도메인)        │
│  video_id FK, domain, relevance_score,               │
│  source ('batch_trend'|'realtime'|'lora'|'user_add') │
└─────────────────────────────────────────────────────┘
                       │
                       ▼ (유저 요청 시 매칭)
┌─────────────────────────────────────────────────────┐
│            recommendation_cache (기존)               │
│  유저별/만다라별 추천 결과 — 변경 없음                 │
└─────────────────────────────────────────────────────┘
```

---

## 3. DB 스키마

### 3-1. video_pool (영상 마스터)

```sql
CREATE TABLE video_pool (
  video_id        VARCHAR(20) PRIMARY KEY,   -- YouTube video ID
  title           TEXT NOT NULL,
  description     TEXT,
  channel_name    VARCHAR(200),
  channel_id      VARCHAR(30),
  view_count      BIGINT DEFAULT 0,
  like_count      BIGINT DEFAULT 0,
  duration_seconds INT,
  published_at    TIMESTAMPTZ,
  thumbnail_url   TEXT,
  language        VARCHAR(5) NOT NULL,       -- 'ko' | 'en'
  
  -- 품질 메타
  quality_tier    VARCHAR(10) NOT NULL       -- 'gold' | 'silver' | 'bronze'
                  DEFAULT 'bronze',
  -- gold: viewCount ≥ 100K, silver: ≥ 10K, bronze: ≥ 1K
  
  -- 캐시 관리
  source          VARCHAR(20) NOT NULL,      -- 'batch_trend' | 'batch_popular' | 'realtime_api' | 'user_add'
  cached_at       TIMESTAMPTZ DEFAULT now(),
  refreshed_at    TIMESTAMPTZ DEFAULT now(), -- 마지막 메타데이터 갱신
  expires_at      TIMESTAMPTZ DEFAULT now() + interval '30 days',
  is_active       BOOLEAN DEFAULT true       -- soft delete
);

-- 만료 자동 비활성화 (pg_cron 매일)
-- UPDATE video_pool SET is_active = false WHERE expires_at < now();

CREATE INDEX idx_vpool_language ON video_pool (language) WHERE is_active;
CREATE INDEX idx_vpool_quality ON video_pool (quality_tier) WHERE is_active;
CREATE INDEX idx_vpool_expires ON video_pool (expires_at);
CREATE INDEX idx_vpool_source ON video_pool (source);
```

### 3-2. video_pool_embeddings (임베딩)

```sql
CREATE TABLE video_pool_embeddings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id        VARCHAR(20) NOT NULL REFERENCES video_pool(video_id) ON DELETE CASCADE,
  embedding       vector(1024) NOT NULL,     -- BGE-M3
  text_input      TEXT,                       -- 임베딩 생성에 사용된 텍스트 (title + desc snippet)
  model_version   VARCHAR(50) DEFAULT 'bge-m3-v1',
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(video_id, model_version)
);

-- pgvector 인덱스 (코사인 유사도)
CREATE INDEX idx_vpool_emb_cosine 
  ON video_pool_embeddings 
  USING ivfflat (embedding vector_cosine_ops) 
  WITH (lists = 100);
```

### 3-3. video_pool_domain_tags (도메인 태깅)

```sql
CREATE TABLE video_pool_domain_tags (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id        VARCHAR(20) NOT NULL REFERENCES video_pool(video_id) ON DELETE CASCADE,
  domain          VARCHAR(50) NOT NULL,      -- '기술/개발', 'Tech/Development' 등
  relevance_score FLOAT DEFAULT 0.5,         -- 0-1, 도메인 관련도
  source          VARCHAR(20) NOT NULL,      -- 태깅 출처
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(video_id, domain)
);

CREATE INDEX idx_vpool_domain ON video_pool_domain_tags (domain);
CREATE INDEX idx_vpool_domain_score ON video_pool_domain_tags (domain, relevance_score DESC);
```

### 3-4. video_pool_collection_runs (배치 수집 이력)

```sql
CREATE TABLE video_pool_collection_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_type        VARCHAR(20) NOT NULL,      -- 'daily_trend' | 'popular_goals' | 'refresh'
  started_at      TIMESTAMPTZ DEFAULT now(),
  ended_at        TIMESTAMPTZ,
  status          VARCHAR(20) DEFAULT 'running', -- 'running' | 'success' | 'failed'
  
  -- 통계
  queries_executed INT DEFAULT 0,
  videos_found     INT DEFAULT 0,
  videos_new       INT DEFAULT 0,             -- 신규 추가
  videos_updated   INT DEFAULT 0,             -- 메타 갱신
  videos_expired   INT DEFAULT 0,             -- 만료 처리
  quota_used       INT DEFAULT 0,             -- YouTube API units 소모
  
  error           TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);
```

---

## 4. 배치 수집 프로세스

### 4-1. batch-video-collector skill

```
등록: SkillRegistry
스케줄: pg_cron '0 4 * * *' (매일 04:00 UTC = 한국 13:00)
API: 서버 키 (YOUTUBE_API_KEY_SEARCH) — 유저 OAuth 절대 사용 금지
```

**수집 소스 3가지:**

```
[Source A] 트렌드 키워드 (trend-collector 산출물)
  입력: data/trends/trend_keywords_latest.json
  도메인 9개 × 상위 키워드 20개 = 180개 검색어
  YouTube Search: maxResults=30, relevanceLanguage 동적
  → 최대 5,400개 후보

[Source B] 인기 만다라 목표
  입력: SELECT center_goal, language, COUNT(*) 
        FROM user_mandalas 
        GROUP BY center_goal, language 
        ORDER BY count DESC LIMIT 50
  50개 목표 → extractCoreKeyphrase → YouTube Search
  → 최대 1,500개 후보

[Source C] 기존 캐시 갱신 (refresh)
  입력: SELECT video_id FROM video_pool 
        WHERE refreshed_at < now() - interval '7 days' 
        AND is_active = true
        LIMIT 500
  videos.list로 view_count/like_count 갱신
  → 삭제된 영상 is_active=false 처리
```

**수집 파이프라인:**

```
1. 검색어 생성 (규칙 기반, LLM 호출 없음)
   - trend 키워드 그대로 사용
   - 인기 목표는 extractCoreKeyphrase 적용

2. YouTube Search API (서버 키)
   - relevanceLanguage: 키워드 언어 기반
   - videoDuration: medium (4-20분)
   - type: video
   - order: relevance
   - maxResults: 30

3. 중복 제거
   - video_id 기준 — 이미 video_pool에 있으면 skip (refreshed_at만 갱신)

4. videos.list 배치 호출 (50개씩)
   - statistics: viewCount, likeCount
   - contentDetails: duration
   → quality_tier 분류: ≥100K=gold, ≥10K=silver, ≥1K=bronze, <1K=drop

5. 품질 게이트
   - viewCount < 1,000 → drop
   - duration < 60s (Shorts) → drop
   - duration > 3,600s (1시간+) → drop
   - title blocklist (광고/PPL/드라마) → drop

6. 임베딩 생성
   - text = title + description[:200]
   - BGE-M3 via Mac Mini Ollama (배치 모드)
   - 50개씩 batch embed

7. 도메인 태깅
   - 검색 키워드의 도메인 → 영상에 태그
   - 하나의 영상이 여러 도메인에 태깅 가능

8. DB UPSERT
   - video_pool: ON CONFLICT (video_id) DO UPDATE SET refreshed_at, view_count, ...
   - video_pool_embeddings: ON CONFLICT (video_id, model_version) DO NOTHING
   - video_pool_domain_tags: ON CONFLICT (video_id, domain) DO NOTHING

9. 만료 처리
   - UPDATE video_pool SET is_active = false WHERE expires_at < now()

10. 리포트 → video_pool_collection_runs INSERT
```

### 4-2. Quota 분산

```
Source A (트렌드): 180 검색어 × 100 units = 18,000 units
Source B (인기 목표): 50 검색어 × 100 units = 5,000 units
Source C (갱신): 500 / 50 = 10 batches × 1 unit = 10 units
videos.list: ~200 batches × 1 unit = 200 units

일 합계: ~23,200 units

일 10K 한도 기준:
  → Source A를 3일로 분산 (60 검색어/일 = 6,000 units)
  → Source B를 2일로 분산 (25 검색어/일 = 2,500 units)
  → 일 소모: ~8,500 units (한도 내)

서버 키 추가 시 (별도 GCP 프로젝트):
  → 일 20K → 하루에 전부 가능
```

### 4-3. 운영 일정

```
매일 04:00 UTC:
  - Source A: 오늘 할당분 (60 검색어)
  - Source C: 갱신 (500건)
  - 만료 처리

매주 월요일 04:00 UTC:
  - Source B: 인기 목표 갱신 (50 검색어)

매월 1일:
  - 전체 통계 리포트
  - 캐시 히트율 분석
  - 도메인별 커버리지 확인
```

---

## 5. 유저 요청 시 매칭 로직

### 5-1. Tier 1: 캐시 매칭 (목표 1-2초)

```sql
-- 셀별 상위 5개 매칭 (pgvector cosine similarity)
WITH sub_goal_embs AS (
  -- 만다라 생성 시 이미 계산된 sub_goal 임베딩 8개
  SELECT cell_index, embedding 
  FROM mandala_embeddings 
  WHERE mandala_id = $1
),
candidates AS (
  SELECT 
    vp.video_id,
    vp.title,
    vp.view_count,
    vp.quality_tier,
    sg.cell_index,
    1 - (vpe.embedding <=> sg.embedding) AS cosine_sim
  FROM video_pool vp
  JOIN video_pool_embeddings vpe ON vp.video_id = vpe.video_id
  CROSS JOIN sub_goal_embs sg
  WHERE vp.is_active = true
    AND vp.language = $2              -- 만다라 언어
    AND vp.quality_tier IN ('gold', 'silver')  -- bronze 제외
  ORDER BY cosine_sim DESC
),
ranked AS (
  SELECT *,
    ROW_NUMBER() OVER (PARTITION BY cell_index ORDER BY cosine_sim DESC) AS rn
  FROM candidates
  WHERE cosine_sim >= 0.3             -- 최소 관련성 임계값
)
SELECT * FROM ranked WHERE rn <= 5;   -- 셀당 5개
```

**성능 예상:**
- video_pool 10,000건 × sub_goals 8개 = 80,000 거리 계산
- ivfflat 인덱스로 lists=100 → ~800 거리 계산으로 축소
- PostgreSQL + pgvector: ~200ms 예상
- 전체 (쿼리 + 결과 처리): 1-2초

### 5-2. Tier 2: 부족분 실시간 보충

```
조건: Tier 1 결과 < 40개

처리:
  1. 부족한 셀 파악
  2. C+ 프롬프트로 검색어 생성 (LLM 1회, OpenRouter Haiku)
  3. YouTube Search API (부족한 셀만, 서버 키)
  4. 품질 게이트 + 임베딩 계산
  5. video_pool에 저장 (다음 유저를 위한 캐시 확장)
  6. recommendation_cache에 결과 추가
```

### 5-3. Tier 3: LoRA 백그라운드 보강

```
조건: Tier 1+2 완료 후 비동기

처리:
  1. LoRA 모델이 만다라 구조 분석
  2. video_pool에서 LoRA 추천 점수 재계산
  3. 기존 카드보다 높은 점수 영상 발견 시 교체/추가
  4. source='lora'로 태깅

시점: LoRA v14 학습 완료 후 활성화
```

---

## 6. 캐시 관리 정책

### 6-1. TTL 정책

| 항목 | TTL | 이유 |
|------|-----|------|
| video_pool 기본 | 30일 | YouTube 영상은 오래 유효 |
| 임베딩 | 무기한 (영상 삭제 시 cascade) | 재계산 비용 절약 |
| 도메인 태그 | 무기한 | 변하지 않음 |
| 메타데이터 갱신 | 7일마다 | viewCount 변동 반영 |

### 6-2. 캐시 크기 목표

```
Phase 1 (1주 후): 5,000건
Phase 2 (1달 후): 15,000건
Phase 3 (3달 후): 30,000건

도메인당 ~3,300건 (30K / 9 도메인)
언어당 ~15,000건 (KO/EN 반반)
```

### 6-3. 히트율 모니터링

```sql
-- 캐시 히트율 계산 (주간)
SELECT 
  DATE_TRUNC('week', created_at) AS week,
  COUNT(*) FILTER (WHERE source = 'cache') AS cache_hits,
  COUNT(*) FILTER (WHERE source = 'realtime') AS cache_misses,
  ROUND(
    COUNT(*) FILTER (WHERE source = 'cache')::numeric / 
    NULLIF(COUNT(*), 0) * 100, 1
  ) AS hit_rate_pct
FROM recommendation_cache
GROUP BY week
ORDER BY week DESC;
```

**목표: 히트율 80%+** — 미달 시 배치 키워드 조정.

### 6-4. 캐시 무효화

```
자동 무효화:
  - expires_at 도달 → is_active = false
  - videos.list 갱신 시 영상 삭제 확인 → is_active = false
  - viewCount 급감 (이전 대비 50%+) → quality_tier 재분류

수동 무효화:
  - 관리자 API: DELETE /admin/video-pool/:videoId
  - 도메인 전체 갱신: POST /admin/video-pool/refresh?domain=tech
```

---

## 7. 기존 테이블과의 관계

```
video_pool (신규)          → 영상 마스터 풀 (유저 무관)
  ↓ 매칭
recommendation_cache (기존) → 유저별 만다라별 추천 결과
  ↓ auto-add
user_video_states (기존)    → 유저 카드 (UI 표시)

video_pool은 recommendation_cache의 "소스 풀" 역할.
recommendation_cache.video_id → video_pool.video_id (FK 아님, soft 참조)
```

---

## 8. executor v3 통합 코드 흐름

```typescript
async function executeVideoDiscoverV3(
  mandala: MandalaWithEmbeddings,
  config: { language: string; targetPerCell: number }
): Promise<DiscoverResult> {
  const TARGET = config.targetPerCell * 8; // 40
  const results: CellAssignment[] = [];
  
  // ── Tier 1: 캐시 매칭 (pgvector cosine) ──
  const cached = await matchFromVideoPool(
    mandala.subGoalEmbeddings,  // 8개 벡터
    config.language,
    config.targetPerCell         // 셀당 5개
  );
  results.push(...cached);
  logger.info(`[T1] cache: ${cached.length}/${TARGET}`);
  
  // ── Tier 2: 부족분 실시간 보충 ──
  const deficit = TARGET - results.length;
  if (deficit > 0) {
    const deficitCells = findDeficitCells(results, config.targetPerCell);
    const queries = await buildQueriesForCells(mandala, deficitCells);
    const fresh = await youtubeSearchAndEmbed(queries, SERVER_API_KEY);
    
    // 신규 영상 → video_pool에 저장 (캐시 확장)
    await upsertVideoPool(fresh);
    
    const freshAssigned = assignToDeficitCells(fresh, deficitCells);
    results.push(...freshAssigned);
    logger.info(`[T2] realtime: ${freshAssigned.length}, total: ${results.length}/${TARGET}`);
  }
  
  // ── 결과 저장 ──
  await upsertRecommendationCache(mandala.id, results);
  await autoAddToCards(mandala.id, results);
  
  // ── Tier 3: LoRA 백그라운드 ──
  if (isLoraAvailable()) {
    setImmediate(() => loraEnhanceFromPool(mandala, results));
  }
  
  return {
    total: results.length,
    tier1: cached.length,
    tier2: results.length - cached.length,
    hitRate: cached.length / TARGET
  };
}
```

---

## 9. 구현 순서

```
Phase 1 (즉시): v2 partial 수정 완료 (진행 중)

Phase 2: video_pool 스키마 + 배치 수집
  PR1: DB 마이그레이션 (video_pool + embeddings + domain_tags + collection_runs)
  PR2: batch-video-collector skill (Source A 트렌드)
  PR3: Source B (인기 목표) + Source C (갱신)
  PR4: pg_cron 등록 + 리포트
  → 1주 데이터 축적 기간

Phase 3: executor v3 (3-tier 통합)
  PR5: Tier 1 캐시 매칭 (matchFromVideoPool)
  PR6: Tier 2 fallback (기존 v2 재활용)
  PR7: 통합 테스트 + 히트율 모니터링

Phase 4: LoRA Tier 3 (LoRA v14 학습 완료 후)
  PR8: loraEnhanceFromPool
```

---

## 10. 절대 규칙

```
- video_pool 수집은 서버 API 키만. 유저 OAuth 절대 금지.
- 배치 수집에 LLM API 호출 금지. 검색어는 규칙 기반 (trend 키워드 그대로).
- 서비스 기능 (C+ 검색어 생성, Tier 2 보충)은 OpenRouter Haiku OK.
- video_pool에 Shorts (< 60초) 저장 금지.
- quality_tier bronze (1K-10K) 이하는 Tier 1 매칭에서 제외.
- 캐시 히트율 주간 모니터링 필수. 80% 미달 시 배치 키워드 조정.
- video_pool_collection_runs 리포트 매 실행 기록 필수.
```
