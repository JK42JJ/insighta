# Insighta Trend-based Video Recommendation Engine

> **Status**: Phase 0 (DB schema + design doc)
> **Skill ID**: `video-discover`
> **Owner**: JK
> **Last updated**: 2026-04-07

## 1. 핵심 철학

VidIQ/TubeBuddy는 **크리에이터용** (내 영상을 어떻게 최적화할까).
Insighta는 **학습자용** (내 목표에 맞는 최고의 영상을 어떻게 찾을까).

단순히 트렌드를 모아서 보여주는 게 아니라:

1. **예측** — "이 영상이 사용자 목표에 도움이 될 것이다" 점수 매기기
2. **검증** — 실제로 도움이 됐는지 사용자 행동으로 측정
3. **학습** — 검증 결과로 스코어링 가중치 자동 조정
4. **반복** — 추천 품질이 지속적으로 향상

## 2. 5-Layer 아키텍처

```
[Layer 1] 트렌드 수집          — 외부 데이터 수집 (야간 배치)
    ↓
[Layer 2] 키워드 스코어링 (IKS) — 6축 복합 점수 산출
    ↓
[Layer 3] 영상 매칭 + 추천      — 만다라 셀 × 키워드 × 영상 품질
    ↓
[Layer 4] 검증 (Feedback Loop)  — 추천 결과 vs 실제 사용자 행동
    ↓
[Layer 5] 가중치 자동 조정       — Autoresearch (자기 개선)
```

## 3. Layer 1: 트렌드 수집

### 소스

| # | 소스                       | 수집 데이터          | Phase |
| - | -------------------------- | -------------------- | ----- |
| 1 | YouTube Trending           | 카테고리별 인기 영상 | 1     |
| 2 | YouTube Search Suggest     | 자동완성 키워드      | 1     |
| 3 | Naver DataLab 검색어트렌드 | KO 주간 검색량 추이  | 1     |
| 4 | Naver 쇼핑인사이트         | 상업 트렌드          | 1     |
| 5 | Google Trends              | 글로벌 검색 추이     | 7     |
| 6 | Hacker News                | 기술 뉴스 순위       | 7     |

### 수집 주기

- 매일 03:00 KST: YouTube Trending + Search Suggest
- 주 2회 월/목: Naver DataLab
- (Phase 7) 주 1회 월: Google Trends
- (Phase 7) 매일 03:00 KST: Hacker News

## 4. Layer 2: Insighta Keyword Score (IKS)

VidIQ Keyword Score = 검색량 vs 경쟁도.
Insighta는 **목표 관련도 + 학습 가치 + 콘텐츠 성과** 축 추가.

### 6-Axis Formula

```
IKS = weighted_sum(
  search_demand        × w1,   -- 검색량 (많이 찾는 주제인가)
  competition          × w2,   -- 경쟁도 역수 (좋은 영상이 적을수록 기회)
  trend_velocity       × w3,   -- 트렌드 속도 (지금 뜨고 있는가)
  goal_relevance       × w4,   -- 만다라 셀과의 의미적 관련도
  learning_value       × w5,   -- 학습 가치 (길이, 채널 전문성, 정보 밀도)
  content_performance  × w6,   -- 실제 영상 성과 (Outlier Score, 성장률)
)

초기 가중치 (v1):
  w1=0.15, w2=0.10, w3=0.15, w4=0.25, w5=0.20, w6=0.15
  → Layer 5에서 자동 조정됨
```

### 각 신호 측정 방법

**search_demand**
YouTube Suggest 빈도 + Naver 검색량 + (Phase 7) Google Trends → min-max 정규화

**competition**
키워드 검색 결과 상위 10개 영상의 평균 (조회수 / 채널 구독자 수) → 높을수록 경쟁 → 역수

**trend_velocity**
이번 주 / 지난 주 검색량 비율
- `> 1.5` 급상승
- `< 0.9` 하락

**goal_relevance**
sub_goal 임베딩 ↔ 키워드 임베딩 cosine similarity (Qwen3-Embedding-8B, Mac Mini 서빙)

**learning_value**
- 영상 길이 10–30분 최적
- 채널 구독자 1만+ 가산
- 좋아요율 4%+ 가산
- 챕터(Description timestamps) 존재 시 가산

**content_performance** ★ (CP349 추가, VidIQ 차별 핵심)

키워드의 검색량이 높아도 실제 그 키워드로 만들어진 영상들이 성과를 못 내면 추천 가치 없음.
**키워드 상위 10개 영상에 대해**:
- **Outlier Score** = 조회수 / 채널 구독자 수 (1.0 = 평균, 5.0+ = 강한 outlier)
- **최근 7일 조회수 성장률** (YouTube API `viewCount` snapshot 비교)
- **좋아요율** (likes / views)
- **영상 수명** (publish_at 후 며칠째 조회수가 증가 중인지)

→ 4개 sub-metric을 각각 정규화 후 평균.

## 5. Layer 3: 영상 매칭 + 추천

### Recommendation Score

```
Rec Score =
  IKS                    × 0.35
  + video_quality        × 0.25
  + freshness            × 0.20
  + diversity_bonus      × 0.10
  + historical_accuracy  × 0.10   ← Layer 4 피드백 반영
```

**historical_accuracy**: 이 키워드로 과거 추천한 영상의 사용자 반응 성공률.
처음엔 0.5 (중립), 피드백 쌓이면서 조정.

## 6. Layer 4: Feedback Loop

### 사용자 행동 → 점수

| 행동                  | 점수 | 의미             |
| --------------------- | ---- | ---------------- |
| 노출만 (impression)   | 0.0  | 관심 없음        |
| 클릭 (영상 페이지)    | 0.2  | 약한 관심        |
| 시청 30초+            | 0.4  | 관심 확인        |
| 만다라에 추가         | 0.7  | 목표 관련 확인   |
| 메모 작성             | 0.9  | 학습 가치 확인   |
| "관심없음"            | -0.5 | 부정 피드백      |
| "나중에"              | 0.1  | 약한 긍정        |

### Keyword Accuracy

```
accuracy(keyword, 30일) = sum(action_scores) / count(recommendations)
```

`keyword_accuracy` materialized view로 일 1회 REFRESH.

## 7. Layer 5: Autoresearch (가중치 자동 조정)

### 매주 월요일 04:00 KST

1. `keyword_accuracy` 뷰 REFRESH
2. 통계 분석: accuracy > 0.5 vs < 0.2 키워드의 IKS 6-axis 구성 비교
3. LLM (`recommendation-tuner` 스킬) 분석 — 가중치 조정안 제시
4. VOC 파이프라인 (관리자 승인 7일 대기)
5. 승인 → `scoring_weights` 새 버전 INSERT → `active=true`
6. 다음 주 추천에 새 가중치 적용

## 8. 데이터 모델 (ERD 요약)

```
trend_signals          (외부 트렌드 raw 데이터)
  ↓ aggregate by keyword
keyword_scores         (IKS 6-axis 산출 결과, weight_version 추적)
  ↓ join with mandala
recommendation_cache   (user × mandala × video, status: pending/shown/...)
  ↓ user action
recommendation_feedback (action_score 기록)
  ↓ aggregate
keyword_accuracy (mat. view) → recommendation-tuner → scoring_weights (history)
                                                          ↑
                                                  새 가중치 적용
```

## 9. 스킬 등록 (Plugin Architecture 준수)

> **참조 문서**: `docs/design/insighta-skill-plugin-architecture.md` (CP352 작성 완료, #366)
> (3-Layer: A=SkillRegistry, B=Temporal, C=VOC)
>
> 본 엔진의 3개 스킬은 모두 **신규 플러그인 규격**을 따른다.
> 기존 `src/modules/skills/*.ts` 평면 구조와 다름. (마이그레이션은 별도 작업)

### 디렉토리 구조

```
src/skills/plugins/
├── trend-collector/
│   ├── manifest.ts      ← SkillManifest (cron: '0 3 * * *')
│   ├── executor.ts      ← SkillExecutor: preflight + execute + deliver
│   └── __tests__/
├── video-discover/
│   ├── manifest.ts      ← SkillManifest (event: 'mandala.created' | 'dashboard.viewed')
│   ├── executor.ts
│   └── __tests__/
└── recommendation-tuner/
    ├── manifest.ts      ← SkillManifest (cron: '0 4 * * 1')
    ├── executor.ts
    └── __tests__/
```

### Skill ID + Trigger

| Skill ID                | Trigger                                                | Phase |
| ----------------------- | ------------------------------------------------------ | ----- |
| `trend-collector`       | cron `0 3 * * *`                                       | 1     |
| `video-discover`        | event `mandala.created` / `dashboard.viewed`           | 3     |
| `recommendation-tuner`  | cron `0 4 * * 1`                                       | 6     |

> **네이밍 결정**: 기존 `recommend` 스킬(LLM 지식격차)과 충돌 회피를 위해
> 신규 스킬은 `video-discover`로 명명. 영상 발굴 + 추천 두 의미 모두 포괄.

### 절대 규칙 (Plugin Architecture 준수)

1. **스킬 간 import 금지** — 각 스킬은 독립 모듈. 공통 로직이 필요하면 `src/skills/_shared/`로 분리(향후) 또는 `src/modules/`의 비-스킬 코드 호출.
2. **SkillInterface 계약 준수** — `manifest.ts` (메타데이터) + `executor.ts` (preflight + execute + deliver 3-stage) 구조 필수.
3. **DB 테이블은 스킬 외부(공용)** — 본 문서 §8의 5 테이블은 모두 `public` schema 공용. 특정 스킬 소유 아님.
4. **타 스킬의 테이블은 read-only** — 예: `video-discover`가 `keyword_scores`(IKS) READ는 OK, WRITE 금지. WRITE는 해당 스킬(IKS-scorer)만.
5. **`scoring_weights` 변경은 VOC 경유 필수** — `recommendation-tuner`도 직접 INSERT/UPDATE 금지. 제안만 생성 → admin 승인 → VOC 파이프라인이 INSERT.

### 본 엔진의 테이블 소유권 (Read/Write Matrix)

| 테이블                    | trend-collector | IKS-scorer (Phase 2) | video-discover | recommendation-tuner | UI/API     |
| ------------------------- | --------------- | -------------------- | -------------- | -------------------- | ---------- |
| `trend_signals`           | **W**           | R                    | R              | R                    | -          |
| `keyword_scores`          | -               | **W**                | R              | R                    | -          |
| `recommendation_cache`    | -               | -                    | **W**          | R                    | R          |
| `recommendation_feedback` | -               | -                    | R              | R                    | **W** (UI) |
| `scoring_weights`         | -               | R (active row)       | R (active row) | R + propose          | -          |

`scoring_weights` WRITE 권한은 **VOC 파이프라인** (관리자 승인) 전용.

## 10. 구현 순서

| Phase | 내용                                      | Sub-issue |
| ----- | ----------------------------------------- | --------- |
| 0     | DB 5 테이블 + design doc (이 PR)          | TBD       |
| 1     | trend-collector (YouTube + Naver)         | TBD       |
| 2     | IKS 6-axis 스코어링                       | TBD       |
| 3     | video-discover 스킬 (매칭 + Rec Score)    | TBD       |
| 4     | 대시보드 추천 UI                          | TBD       |
| 5     | Feedback Loop (행동 추적 + accuracy)      | TBD       |
| 6     | recommendation-tuner (Autoresearch)       | TBD       |
| 7     | Google Trends + Hacker News               | TBD       |

**Phase 1–4 = MVP** (추천이 동작함)
**Phase 5–6 = 차별점** (자기 개선)
**Phase 7 = 확장**

## 11. VidIQ/TubeBuddy 차별점

|               | VidIQ            | TubeBuddy       | Insighta                                   |
| ------------- | ---------------- | --------------- | ------------------------------------------ |
| 대상          | 크리에이터       | 크리에이터      | **학습자**                                 |
| 목적          | 내 영상 최적화   | 내 채널 성장    | **내 목표 달성**                           |
| 스코어링      | 검색량 × 경쟁도  | 검색량 × 경쟁도 | **+ 목표관련도 × 학습가치 × 콘텐츠 성과**  |
| 검증          | 조회수/CTR       | A/B 테스트      | **사용자 행동 피드백**                     |
| 학습          | 정적             | 정적            | **가중치 자동 조정**                       |
| 출력          | 키워드 추천      | SEO 최적화      | **만다라 셀 맞춤 영상 + 추천 이유**        |

## 12. Open Questions (Phase 1 진입 전 해소 필요)

### Q1. Naver DataLab API 인증/Quota
- DataLab Open API: 계정 발급 무료, **일 1000회 호출 제한**
- 키워드 1개당 1 call → 야간 배치에서 ~500 키워드 추적 가능
- **결정 필요**: 네이버 개발자 계정 신청 → `NAVER_CLIENT_ID/SECRET` credentials.md 등록

### Q2. Qwen3-Embedding-8B 서빙 위치
- CP349에서 Mac Mini Ollama로 서빙 중 (`100.91.173.17`)
- **goal_relevance** 계산은 키워드 변경 시마다 계산 → 일 호출량 큼
- **결정 필요**: Mac Mini 재활용? 또는 prod EC2에 동일 모델 별도 서빙?
  - Mac Mini: cost $0, 의존성 (집 인터넷, Tailscale uptime)
  - EC2: t3.medium (4 GiB RAM, no GPU)로는 8B 불가 → GPU 인스턴스 필요 ($)

### Q3. YouTube Data API Quota 산정
- 현재 quota 소비처: video metadata, captions, search
- trend-collector 추가 시 추가 소비:
  - `videos.list` (Trending): 1 unit × 카테고리 수 (~10) = 10/일
  - `search.list` (Suggest): 100 units × 쿼리 수 → **위험**
  - `videos.list` (content_performance용 상위 10영상): 1 × 키워드 500 = 500/일
- **결정 필요**: 일 quota 산정 + 한도 초과 시 graceful degradation 정책

### Q4. pgvector HNSW 4096d 제한
- CP349에서 확인된 pgvector HNSW 한도: 2000d
- Qwen3-Embedding-8B = 4096d
- **현재 로컬은 인덱스 없이 운영** → 데이터 늘면 full scan 비용 증가
- **결정 필요**:
  - (a) IVFFlat 인덱스 (4096d 지원, 정확도 약간 손실)
  - (b) 저차원 임베딩 모델로 다운그레이드
  - (c) 차원 축소 (PCA → 1536d)

### Q5. content_performance 측정 시점
- 키워드 스코어링 시 매번 재계산 vs 일 1회 캐시?
- YouTube API quota 부담 직결
- **권장**: 키워드별 1일 1회 캐시 (keyword_scores.scored_at + 24h TTL)

### Q6. recommendation_cache 만료 정책
- 24h TTL 권장 (트렌드 신선도)
- 만료된 row는 어떻게 정리? cron job? 또는 query시 expires_at 필터?
- **권장**: `expires_at` 필터 + 주 1회 vacuum job

### Q7. Service vs System domain 격리 (CLAUDE.md 원칙)
- 5 신규 테이블은 모두 **service domain** (사용자 기능)
- `domain` 컬럼이 필요한지? 또는 service 전용으로 격리?
- **결정 필요**: ontology.nodes/edges 패턴 따를 것인가, 별도 schema?
- **잠정**: 별도 테이블이므로 domain 컬럼 불필요. service domain 전용.

### Q8. 기존 video_summaries / video_rich_summaries와 관계
- 현재 영상 메타데이터는 `video_summaries`, `video_rich_summaries` 사용
- `recommendation_cache.video_id`가 이 테이블들을 참조해야 하는가?
- **권장**: FK 없이 video_id 텍스트만 저장 (외부 영상 메타 캐시 분리)

### Q9. Skill Plugin Architecture doc 부재
- `docs/design/insighta-skill-plugin-architecture.md` 미존재
- 본 디자인 doc은 유저 인라인 스펙(2026-04-07)을 가정하고 작성됨
- **결정 필요**: Phase 1 진입 전 별도 architecture doc 작성
  - SkillManifest 타입 정의
  - SkillExecutor 3-stage 인터페이스 (preflight / execute / deliver)
  - 기존 `src/modules/skills/*.ts` → `src/skills/plugins/{id}/`로 마이그레이션 정책
  - Temporal Layer B 통합 시점 + VOC Layer C 워크플로우

## 13. 추천 정책 (Recommendation Policy)

> **정의 시점**: 2026-04-07 (CP352 보완)
> **구현 위치**: Phase 3 (`src/skills/plugins/video-discover/executor.ts`) + Phase 4 (대시보드 UI)

### 13.1 추천 단위 + 수량

```
셀당 3개 × 8셀 = 주당 24개 추천
갱신: 매주 월요일 04:00 KST (trend-collector + IKS-scorer 직후)
TTL : 7일 (recommendation_cache.expires_at = created_at + 7d)
```

명시 상수 (Phase 3 구현 시 `src/config/video-discover.ts` 모듈 추출 대상):

| Constant                    | Value | 의미                                  |
| --------------------------- | ----- | ------------------------------------- |
| `RECS_PER_CELL`             | `3`   | 셀당 추천 영상 수                     |
| `CELLS_PER_MANDALA`         | `8`   | 만다라 sub_goal 수 (center 제외)      |
| `RECS_PER_MANDALA_PER_WEEK` | `24`  | 위 둘의 곱                            |
| `RECOMMENDATION_TTL_DAYS`   | `7`   | recommendation_cache TTL              |
| `RECOMMENDATION_REFRESH_DOW` | `1`  | 갱신 요일 (0=일, 1=월)                |
| `RECOMMENDATION_REFRESH_HOUR_KST` | `4` | 갱신 시각 (KST)                  |

> 만료 정책 정리: `expires_at` 필터 + 주 1회 vacuum job (Open Question Q6 잠정 결정).

### 13.2 대시보드 표시 정책

```
대시보드 상단: 전체 Top 3
  → 8셀 추천 24개 중 rec_score 상위 3개
  → 다양성 보정: 같은 셀에서 2개 이상 뽑지 않음

셀 클릭 시: 해당 셀의 3개 표시 (rec_score 내림차순)

각 영상 카드 액션: [추가] [나중에] [관심없음]
  → "추가"   → 해당 셀의 카드로 편입 (recommendation_feedback action='add', score=0.7)
  → "나중에" → 일단 숨김, 다음 갱신까지 유지 (action='later', score=0.1)
  → "관심없음" → 즉시 숨김 + 같은 채널/키워드 향후 가중치 하향 (action='dismiss', score=-0.5)
```

### 13.3 사용자 액션 → recommendation_feedback 매핑

§6 (Feedback Loop) 표와 일관성 유지:

| UI 액션         | DB action   | action_score |
| --------------- | ----------- | ------------ |
| 카드 노출       | `impression`| `0.0`        |
| 썸네일 클릭     | `click`     | `0.2`        |
| 30초+ 시청      | `watch_30s` | `0.4`        |
| **[추가]**      | `add`       | `0.7`        |
| 메모 작성       | `memo`      | `0.9`        |
| **[나중에]**    | `later`     | `0.1`        |
| **[관심없음]**  | `dismiss`   | `-0.5`       |

> `recommendation_feedback.action`은 `VARCHAR(20)`로 free-form. 위 7개 값이 SSOT — Phase 5 구현 시 enum으로 굳힐 것.

### 13.4 갱신 사이클과 cron 정합

- `trend-collector` (Phase 1, cron `0 3 * * *`) → 매일 트렌드 신호
- `IKS-scorer` (Phase 2, 트리거 미확정) → 신호 갱신 후 키워드 점수
- `video-discover` (Phase 3, 이벤트 + cron) → 매주 월 04:00 (RECS_PER_MANDALA_PER_WEEK 생성) + `mandala.created` 즉시 1회
- `recommendation-tuner` (Phase 6, cron `0 4 * * 1`) → 주간 가중치 검토 (`video-discover`와 같은 시각, 직후 실행)

## 14. 카드 Eviction 정책

> **정의 시점**: 2026-04-07 (CP352 보완)
> **구현 위치**: Phase 4 (`src/modules/cards/eviction.ts` — 신설 예정)
> **적용 범위**: video-discover로 추가되는 카드뿐 아니라 **모든 자동 추가 카드** (recommend, news 등 향후 모든 스킬)

### 14.1 셀당 한도

```
CELL_CARD_LIMIT = 8     // 만다라트 8×8 구조와 대칭
사용자 흔적 있는 카드: 한도 초과 허용 (영구 보존)
```

### 14.2 사용자 흔적 (user trace) 정의

다음 중 **하나라도** 있으면 영구 보존 (eviction 대상에서 제외):

| 조건               | 판정 필드 (잠정)                       |
| ------------------ | -------------------------------------- |
| 메모 작성          | `local_cards.memo_count > 0` 또는 별도 join |
| 타임스탬프 추가    | `card_timestamps` 행 존재              |
| 수동 셀 이동       | `local_cards.is_manually_moved = true` |
| 시청 완료 표시     | `local_cards.is_watch_completed = true`|

> Phase 4 구현 직전, 위 필드들의 실제 schema 존재 여부를 `prisma/schema.prisma`에서 검증할 것 (현재는 사양 단계).

### 14.3 eviction 알고리즘

```typescript
// src/modules/cards/eviction.ts (Phase 4 신설 예정)
import { CELL_CARD_LIMIT } from '@/config/video-discover';

export async function addCardToCell(cellId: string, newCard: Card) {
  const cards = await getCardsInCell(cellId);

  if (cards.length >= CELL_CARD_LIMIT) {
    const evictable = cards
      .filter((c) => !hasUserTrace(c))
      .sort((a, b) => a.created_at.getTime() - b.created_at.getTime());

    if (evictable.length > 0) {
      // 가장 오래된 흔적 없는 카드 자동 archive (삭제 X)
      await archiveCard(evictable[0].id);
    }
    // else: 모두 흔적 있음 → eviction 없이 한도 초과 허용
  }

  await insertCard(cellId, newCard);
}

export function hasUserTrace(card: Card): boolean {
  return (
    card.has_memo ||
    card.has_timestamps ||
    card.is_manually_moved ||
    card.is_watch_completed
  );
}
```

### 14.4 archive 의미

- **archive ≠ delete**: row는 보존, `status = 'archived'` 마킹만
- 사용자는 "히스토리" 탭에서 언제든 열람/복원 가능
- 추천 결과는 archive된 카드를 중복 제안하지 않음 (`status != 'archived'` 필터)

### 14.5 심리학적 원칙 (절대 위반 금지)

```
✅ 사용자에게 정리를 요구하지 않음 (자동 archive)
✅ 공들인 카드(메모, 타임스탬프)는 절대 사라지지 않음
✅ 열심히 쓸수록 셀이 풍성해짐 (한도 초과 허용 = 보상)
✅ archive는 히스토리에서 언제든 볼 수 있음 (안전망)
❌ "카드가 가득 찼습니다" 같은 알림 절대 안 함
❌ "오래된 카드를 정리하시겠습니까?" 같은 confirm 다이얼로그 금지
❌ 사용자 흔적 있는 카드를 자동 삭제하는 모든 경로 금지
```

### 14.6 video-discover 추천 흐름과의 결합

```
유저 [추가] 클릭 (recommendation_cache → local_cards 편입)
  ↓
addCardToCell(cellId, newCard)
  ↓
한도 8 미만? → 그냥 INSERT
한도 8 이상?
  ├─ 흔적 없는 카드 있음 → 가장 오래된 것 archive → INSERT
  └─ 모두 흔적 있음     → 한도 초과 허용 (INSERT만)
```

→ 유저는 항상 [추가]가 성공한다는 것만 보고, eviction은 백그라운드에서 침묵 처리.

## 15. Out of Scope (Phase 0)

- 코드 작성 (skills, jobs, UI)
- Prod DB 적용
- Cron 등록
- 외부 API 키 발급

## 16. References

- Existing skill pattern: `src/modules/skills/recommend.ts`, `src/modules/skills/types.ts`
- SkillRegistry: `src/modules/skills/registry.ts`
- Quota policy: `docs/policies/quota-policy.md`
- Skill quota policy: `docs/policies/skill-quota-policy.md`
- Mandala embeddings (CP349): `memory/project-mandala-embeddings.md`
- Mac Mini infra: `memory/project-macmini.md`
