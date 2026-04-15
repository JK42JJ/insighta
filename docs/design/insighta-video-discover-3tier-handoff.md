# Video-Discover 3-Tier 캐시 아키텍처 — CC 핸드오프

> 날짜: 2026-04-15
> 근거: SGNL 벤치마크 (20초 36개 고품질) vs Insighta v2 (12초 24개)
> 목표: 만다라 생성 시 카드 40개를 1-2초 내 안정적으로 제공

---

## 1. 현재 상태 (v2)

```
만다라 생성 → LLM 검색어 생성 (C+ 프롬프트, Haiku via OpenRouter)
           → YouTube Search API 3-5회 (서버 키)
           → Jaccard 스코어링 → 셀 분배
           → 12초, 24개 카드
```

문제:
- 매번 실시간 YouTube API 호출 → quota 소모 (300-500 units/만다라)
- 12초 대기 → 유저 체감 느림
- 인기 주제는 매번 비슷한 결과인데 반복 호출

---

## 2. 3-Tier 통합 아키텍처

### Tier 1: 사전 캐시 (즉시 응답, 0-2초)

```
[배치 프로세스 — 매일 1회, pg_cron 또는 GitHub Actions]

입력: trend-collector 키워드 (9개 도메인 × 상위 키워드)
     + 기존 유저 만다라 인기 목표 상위 N개

처리:
  1. 도메인별 인기 검색어 50개 선별
  2. YouTube Search API 호출 (maxResults=50)
  3. 영상 메타데이터 저장 (title, description, videoId, viewCount, duration, publishedAt)
  4. BGE-M3 임베딩 사전 계산 → video_embeddings 테이블 저장
  5. 품질 게이트: viewCount ≥ 10K, duration 60s-3600s, 언어 필터

저장: video_cache 테이블
  - video_id (PK)
  - title, description, channel, view_count, duration, published_at
  - embedding (vector, 1024d)
  - domain (도메인 태그)
  - language (ko/en)
  - cached_at, expires_at (30일)
  - source ('batch_trend' | 'batch_popular' | 'realtime_api' | 'lora')

규모: 9 도메인 × 50 검색어 × 30 결과 = ~13,500개 영상 풀
Quota: 450 × 100 = 45,000 units (일 10K 기준 5일 분산, 또는 서버 키 추가)
```

**유저 요청 시:**
```
만다라 생성 → sub_goal 8개 임베딩 (이미 있음)
           → video_cache에서 cosine similarity 상위 매칭
           → 셀별 top 5 분배
           → 1-2초, YouTube API 호출 0회
```

### Tier 2: 실시간 API 보충 (Tier 1에서 40개 미달 시)

```
조건: Tier 1에서 40개 못 채울 때만 실행

처리:
  1. 부족한 셀 파악 (target 5 - actual)
  2. 해당 셀의 sub_goal로 C+ 검색어 생성 (LLM 1회)
  3. YouTube Search API 호출 (부족분만)
  4. 스코어링 + 분배
  5. 결과를 video_cache에도 저장 (다음 유저를 위한 캐시)

소요: 5-12초 (부족분 규모에 따라)
Quota: 100-300 units (전체 호출 대비 대폭 감소)
```

### Tier 3: LoRA 백그라운드 보강 (비동기, 배치)

```
조건: 만다라 생성 완료 후 백그라운드 실행

처리:
  1. LoRA 모델이 만다라 구조 (center_goal + sub_goals) 분석
  2. 기존 video_cache에서 LoRA 추천 점수 계산
  3. Tier 1/2에서 배치한 카드보다 높은 점수의 영상 발견 시
     → recommendation_cache에 추가 (replace 또는 append)
  4. 유저 다음 방문 시 더 정밀한 카드 표시

특징:
  - 느려도 됨 (유저 대기 없음)
  - LoRA가 아직 없으면 skip (현재 상태)
  - LoRA v14 학습 완료 후 활성화
  - 결과도 video_cache에 저장 (source='lora')
```

---

## 3. 유저 체감 흐름

```
만다라 생성 클릭
  → [1-2초] Tier 1 캐시에서 30-40개 즉시 표시
  → [부족 시 +5-12초] Tier 2 실시간 보충, 스켈레톤→카드 전환
  → [백그라운드] Tier 3 LoRA가 품질 개선
  → [다음 방문] 더 정밀한 카드로 교체됨
```

---

## 4. DB 스키마 변경

### 신규 테이블: video_cache

```sql
CREATE TABLE video_cache (
  video_id VARCHAR(20) PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  channel_name VARCHAR(200),
  channel_id VARCHAR(30),
  view_count BIGINT DEFAULT 0,
  duration_seconds INT,
  published_at TIMESTAMPTZ,
  language VARCHAR(5),        -- 'ko' | 'en'
  domain VARCHAR(50),         -- '기술/개발' 등
  embedding vector(1024),     -- BGE-M3
  source VARCHAR(20) NOT NULL, -- 'batch_trend' | 'realtime_api' | 'lora'
  cached_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ DEFAULT now() + interval '30 days',
  quality_score FLOAT         -- view gate + freshness 복합 점수
);

CREATE INDEX idx_video_cache_embedding ON video_cache 
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX idx_video_cache_domain ON video_cache (domain);
CREATE INDEX idx_video_cache_language ON video_cache (language);
CREATE INDEX idx_video_cache_expires ON video_cache (expires_at);
```

### 기존 테이블 변경 없음
- recommendation_cache: 그대로 유지 (유저별 만다라별 추천)
- video_cache → recommendation_cache 연결은 video_id로

---

## 5. 배치 프로세스 설계

### batch-video-collector (신규 skill)

```
스케줄: pg_cron 매일 04:00 UTC (한국 13:00)

입력:
  1. data/trends/trend_keywords_latest.json (trend-collector 산출물)
  2. SELECT center_goal, COUNT(*) FROM user_mandalas 
     GROUP BY center_goal ORDER BY count DESC LIMIT 100
     → 인기 목표 상위 100개

처리:
  1. 도메인별 키워드 → YouTube Search (서버 키, relevanceLanguage)
  2. 품질 게이트 (viewCount ≥ 10K, duration 60s-3600s)
  3. 임베딩 계산 (BGE-M3, Mac Mini Ollama)
  4. video_cache UPSERT (ON CONFLICT video_id DO UPDATE)
  5. expires_at 지난 건 삭제

출력: 일일 리포트
  - 신규 캐시: N건
  - 갱신: M건
  - 만료 삭제: K건
  - 총 캐시: T건
```

### Quota 분산 전략

```
일 10,000 units 기준:
  - 배치 수집: 5,000 units/일 (50 검색어 × 100 units)
  - 실시간 Tier 2: 5,000 units/일 (약 10-15 만다라 보충분)

서버 키 추가 시 (새 GCP 프로젝트):
  - 배치: 10,000 units (별도 키)
  - 실시간: 10,000 units (메인 키)
  → 제약 사실상 해소
```

---

## 6. executor 통합 흐름 (v3)

```typescript
async function executeVideoDiscoverV3(mandala, subGoalEmbeddings) {
  const results: VideoResult[] = [];
  
  // ── Tier 1: 캐시 매칭 ──
  const cached = await matchFromCache(subGoalEmbeddings, mandala.language);
  // cached: { cellIndex, videoId, score }[]
  const assigned = assignToCell(cached, TARGET_PER_CELL=5);
  results.push(...assigned);
  
  const deficit = TARGET_TOTAL - results.length;
  
  // ── Tier 2: 부족분 실시간 보충 ──
  if (deficit > 0) {
    const deficitCells = findDeficitCells(assigned, TARGET_PER_CELL);
    const queries = await buildQueriesForCells(mandala, deficitCells); // C+ LLM
    const fresh = await youtubeSearch(queries, SERVER_API_KEY);
    
    // 신규 영상 → 캐시에도 저장 (다음 유저를 위해)
    await upsertVideoCache(fresh);
    
    const freshAssigned = assignToCell(fresh, deficitCells);
    results.push(...freshAssigned);
  }
  
  // ── 결과 저장 ──
  await upsertRecommendationCache(mandala.id, results);
  await autoAddToCards(mandala.id, results);
  
  // ── Tier 3: 백그라운드 LoRA (fire-and-forget) ──
  if (isLoraAvailable()) {
    setImmediate(() => loraEnhance(mandala, results));
  }
  
  return { total: results.length, source: { tier1: cached.length, tier2: fresh?.length ?? 0 } };
}
```

---

## 7. 구현 순서

```
Phase 1 (즉시): v2 partial 수정 완료 (현재 진행 중)
  → partial 시 auto-add 진행 + error 필드 정리

Phase 2: video_cache 테이블 + 배치 수집 스킬
  → DB 스키마 추가
  → batch-video-collector skill 작성
  → pg_cron 등록
  → 1주 데이터 축적

Phase 3: executor v3 (3-tier 통합)
  → Tier 1 캐시 매칭 로직
  → Tier 2 fallback (기존 v2 재사용)
  → 통합 테스트

Phase 4: LoRA Tier 3 (LoRA v14 학습 완료 후)
  → 백그라운드 보강 로직
  → A/B 테스트 (LoRA 추천 vs 기존)
```

---

## 8. 성공 지표

| 지표 | v2 현재 | v3 목표 |
|------|---------|---------|
| 소요시간 (캐시 히트) | 12초 | 1-2초 |
| 소요시간 (캐시 미스) | 12초 | 12초 (Tier 2) |
| 카드 수 | 24개 | 40개 |
| 관련성 | ~80% | ≥95% |
| YouTube API 호출/만다라 | 3-5회 | 0회 (캐시 히트 시) |
| 일 quota 소모 | ~500/만다라 | ~0/만다라 (캐시 히트) |

---

## 9. 절대 규칙

```
- video_cache는 서버 API 키로만 수집. 유저 OAuth 사용 금지.
- Tier 2 실시간 호출도 서버 키. 유저 OAuth는 구독/재생목록 동기화에만.
- LoRA Tier 3는 API 호출 아님. 기존 캐시 데이터 재스코어링만.
- 배치 수집에 Anthropic/OpenRouter API 사용 금지 (검색어는 규칙 기반).
  단, 서비스 기능(C+ 검색어 생성)은 OpenRouter Haiku 사용 OK.
- video_cache expires_at 30일. 만료된 건 자동 삭제.
- 캐시 히트율 모니터링 필수. 히트율 < 50%면 배치 키워드 조정.
```

---

## 10. SGNL 벤치마크 참조

```
테스트: "AI 대학원 진학하기"
  SGNL: 20초, 36개, 관련성 ~95%
  Insighta v2: 12초, 24개, 관련성 ~80%

추정: SGNL은 사전 캐시 + 실시간 보충 하이브리드.
  → 동일 패턴을 Insighta에 적용하면 1-2초 + 40개 달성 가능.
```
