# Handoff — Card Preference Signal (Heart/Archive) → On-demand v2 + Personalized Re-rank

**Date**: 2026-05-15 (CP461)
**Status**: **BACKLOG** — 별도 PR/스프린트.
**Origin**: 사용자 UX 설계 제안. 위저드 추천 카드를 사용자가 명시적으로 선택/거부하는 경험으로 → preference signal 누적 → 다음 검색 품질 즉시 향상.

---

## 1. Design (자연어 요약)

**그리드뷰 카드 하단**:
- **우하단 = Heart** (현재 북마크 영역 확장). 클릭 시 (a) signal 기록 + (b) `enrichRichSummary` 비동기 fire-and-forget 즉시 트리거. "분석 중" 인디케이터 → 완료 시 카드 우상단 ✓ 표시 또는 클릭 시 풍부한 요약 즉시 제공.
- **좌하단 = Archive** (사실상 제거). 클릭 시 (a) signal 기록 + (b) 만다라에서 카드 제거 (scratchpad 또는 hidden). undo toast 제공.

**Signal 의 활용**:
- 매 카드 재검색 (`v3/executor.ts` → `hybrid-rerank.ts`) 마다 사용자 like/archive signal 을 reranker feature 로 입력.
- liked 영상의 embedding similarity = boost. archived = penalty.
- channel-level / topic-level / keyword-level 추가 가중. cohere rerank 점수와 가중합.

**결과**: cold start 없이 첫 검색부터 점진적 개인화. 만다라가 "진짜 학습 큐레이션" 으로 정제.

---

## 2. 가치 (factual)

| 요소 | 효과 |
|---|---|
| Heart → v2 즉시 비동기 트리거 | 사용자 관심 표현이 곧 콘텐츠 분석 트리거 = LLM/proxy 비용 효율 (무관심 영상 분석 안 함). 본 세션 chatbot-transcript handoff §Part B 의 user-driven 버전 |
| Archive → 만다라 정제 | mandala = 진짜 학습 큐레이션. noise 제거 = 사용자 만족도 ↑ |
| 두 signal → 재검색 reranker 입력 | 매 검색마다 점진 개인화. cold start 없음 |
| Implicit (watch-time) 대비 | explicit signal = 노이즈 적음, 분류 신뢰도 ↑ |

---

## 3. DB Schema 결정

두 옵션 비교:

### Option A — Simple (`user_local_cards` 컬럼 추가)
```sql
ALTER TABLE user_local_cards
  ADD COLUMN IF NOT EXISTS liked_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_user_local_cards_liked_at
  ON user_local_cards (user_id, liked_at DESC) WHERE liked_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_user_local_cards_archived_at
  ON user_local_cards (user_id, archived_at DESC) WHERE archived_at IS NOT NULL;
```
- Pro: 1-day 작업
- Con: 시계열 분석 어려움 (toggle 이력 없음), 카드 삭제 시 signal 사라짐

### Option B — Dedicated table (권장)
```sql
CREATE TABLE card_user_signals (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  video_id    VARCHAR(11) NOT NULL,
  signal      TEXT NOT NULL CHECK (signal IN ('like','archive','watch_complete','skip')),
  mandala_id  UUID REFERENCES user_mandalas(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, video_id, signal)  -- latest wins for like/archive
);
CREATE INDEX idx_signals_user_signal_created ON card_user_signals (user_id, signal, created_at DESC);
CREATE INDEX idx_signals_video ON card_user_signals (video_id);
```
- Pro: 다양한 signal 누적 (watch_complete, skip 등 향후 추가), 카드 삭제와 무관하게 history 유지, 시계열 분석 가능
- Con: 추가 join 비용 (작음)

**권장**: **Option B**. 미래 확장성 (구독, 공유, 추천 학습) 과 호환. mandala 공유 시 contributor signal 분석에도 유용.

---

## 4. BE Endpoints

신규:
```
POST /api/v1/cards/:videoId/like
  body: { mandalaId?: string }  // 컨텍스트 (재현 시점 만다라)
  effect: card_user_signals INSERT (UNIQUE conflict update created_at)
          + fire-and-forget enrichRichSummary(videoId, {userId, ...})
  returns: 202 { triggered: boolean, alreadyRich: boolean }

POST /api/v1/cards/:videoId/unlike
  effect: card_user_signals DELETE (user_id, video_id, signal='like')
  returns: 204

POST /api/v1/cards/:videoId/archive
  body: { mandalaId: string }
  effect: card_user_signals INSERT + user_local_cards UPDATE set hidden / 만다라에서 제거
  returns: 204

POST /api/v1/cards/:videoId/unarchive
  effect: 위 역동작
  returns: 204
```

**구현 노트**:
- `enrichRichSummary` 호출은 본 세션 chatbot-transcript handoff Phase B 와 동일 — 직접 호출 (NOT `enrichVideo` 경유 — cache-hit-skip 문제).
- `RICH_SUMMARY_ENABLED=false` 가 prod default (`config/rich-summary.ts:39`). Heart trigger 효과 발휘하려면 prod env 활성화 필요 — 별 결정.
- Quota: `assertRichSummaryQuota` 가 user-monthly 적용. Free/Pro/Lifetime 별 분포 사전 검토 필요.

---

## 5. FE Components

**Grid card 변경 위치**: `frontend/src/widgets/card-grid/` 또는 `frontend/src/entities/card/ui/CardItem.tsx` 등 (확인 필요).

**Layout**:
```
┌─────────────────────────────────┐
│  [thumbnail]                    │
│  Title (2 lines)                │
│  Channel · views                │
├─────────────────────────────────┤
│ [Archive 좌하단]  [Heart 우하단]│
└─────────────────────────────────┘
```

- Heart toggle: 회색 outline → 빨간 fill. 클릭 직후 spinner 3-5초 → 우상단 small ✓ badge ("분석 완료") 또는 "분석 중" pulse animation 까지.
- Archive: 클릭 → 1초 fade-out + bottom toast "보관됨. 되돌리기 ↶" (5초 후 영구).
- 진행 상태 SSE 또는 TanStack Query polling (3-5초 간격, v2 row 등장 시 stop).

---

## 6. Reranker Signal 통합

**위치**: `src/skills/plugins/video-discover/v3/hybrid-rerank.ts`.

신규 feature 컬럼:
```ts
interface HybridRerankInput {
  // ... existing fields
  userLikedVideoIds?: string[];      // 최근 100개 like
  userArchivedVideoIds?: string[];   // 최근 100개 archive
  userLikedChannels?: string[];      // distinct channels from likes
  userArchivedChannels?: string[];   // distinct channels from archives
}
```

**Scoring**:
- candidate의 embedding 과 user liked-set 평균 embedding cosine = `like_sim_score` → +가중
- candidate의 channel ∈ user liked-channels → +bonus
- candidate의 channel ∈ user archived-channels → -penalty (heavy)
- candidate video_id ∈ user archived-set → exclude 완전 (re-recommendation 방지)
- final = cohere_score × w1 + like_sim × w2 + channel_signal × w3 + tsvector_score × w4

**A/B 측정**: PR #463 quality_gate baseline 패턴 따라 control vs personalized 2-arm. CTR + Heart-rate + Archive-rate 비교.

---

## 7. 미결 결정 (decision required)

| # | 결정 사항 | 옵션 |
|---|---|---|
| 1 | 기존 북마크 기능 | (a) heart 로 대체 (단순) / (b) 별도 보관 (북마크 = 즐겨찾기 / heart = 선호 signal) |
| 2 | Archive 범위 | (a) 만다라에서만 제거 / (b) "다시 추천하지마" 전역 signal / (c) 둘 다 — 같은 만다라 추천에서 즉시 제외 + 다른 만다라엔 영향 적게 |
| 3 | Heart 비용 제어 | (a) 같은 영상 첫 like 만 trigger / (b) 매번 trigger (대부분 cache hit 이긴 함) |
| 4 | Signal 적용 범위 | (a) 같은 만다라 내 재검색만 / (b) user-level cross-mandala (전체 만다라에서 학습) — (b) 가 학습 신호 풍부 |
| 5 | 공유 만다라 (closed/open) 와의 관계 | clone 시 signal 복사 안 함 (viewer 새 시작). closed mode 멤버의 signal 은 본인 것만 / 만다라 owner 도 본인 것만 |
| 6 | `RICH_SUMMARY_ENABLED` prod 활성화 | Heart trigger 효과 발휘 위해 필수. 별 결정 (quota 영향 검토 후). chatbot-transcript handoff §Part B 와 같은 결정 항목 |

---

## 8. Phase Plan

| Phase | 작업 | 기간 |
|---|---|---|
| **Phase 1** | DB schema (`card_user_signals` 테이블 + raw DDL local first → CI/CD prod migrate) | 0.5일 |
| **Phase 2** | BE endpoints (`/like`, `/unlike`, `/archive`, `/unarchive`) + `enrichRichSummary` trigger 연결 + tsc + jest smoke | 1일 |
| **Phase 3** | FE grid card 하단 UI (heart + archive) + "분석 중" 인디케이터 + SSE/poll 통합 + undo toast | 2일 |
| **Phase 4** | Reranker signal feature 통합 (`hybrid-rerank.ts`) + A/B 측정 셋업 (control vs personalized) | 2-3일 |
| **Phase 5** | **Re-search Add (refine within mandala)** — Notion 식 좌→우 slide-in panel, locked base query (mandala center_goal), chip keyword 추가 + 미세 filter 만 허용, heart cross-panel transfer | 2일 |

**총 ~7-9일** (1 dev). mandala sharing backlog 와 **독립**적으로 ship 가능 (의존 없음).

### Phase 5 상세 — Re-search Add (SUPERSEDED — CP466 → Add Cards)

> **⚠️ SUPERSEDED by `docs/design/add-cards-2026-05-18.md` (CP466, 2026-05-18).**
> 명칭 "Re-search Add" / `+ 더 찾기` 폐기 → "Add Cards" / "카드 추가"
> 채택. Slide-in panel + locked base + chip + 5 filter + Heart cross-panel
> spec 은 후속 doc 으로 이관 + `card-refresh-strategy.md` 의 4-layer 모델
> 과 통합. 본 섹션은 **historical reference only**. CP466 결정 record:
> `retrospective.md` Rule Evolution Log 2026-05-18.


**Trigger / Layout** (Notion 패턴):
- 만다라 우상단 칩 `+ 더 찾기` 클릭 → 우측 panel 이 `translateX(100%)→0` slide-in (~250ms ease-out). 폭 = viewport 40-45% (desktop), full-screen overlay (mobile).
- 메인 만다라 grid 는 왼쪽 살아있음 — 큐레이션 visible.
- Esc / 외부 click / X → slide-out. State (검색어/결과) 는 TanStack Query staleTime 으로 재오픈 시 보존.
- Stacked slide: 검색 결과 카드 클릭 시 detail panel 이 그 위로 nested slide-in (depth 2 권장). Notion peek 패턴.

**Right panel 내부 구조**:

```
🔒 "Python 프로그래밍 마스터"     ← mandala center_goal, 읽기 전용 (서버 resolve)

키워드 추가 (+):
  [초보자×] [실전×] [+ 추가]       ← chip 형태, 자동완성 suggest

미세 필터:
  도메인  [▼ 전체]
  언어    [▼ KO]
  기간    [▼ 1년 이내]
  길이    [▼ 5분 이상]
  정렬    [▼ 관련도]

결과 (40)                  [X]
  [card 🤍 🗑] [card 🤍 🗑] ...
```

**Locked base**: `center_goal` 은 서버에서 `mandalaId` 로 resolve. 클라이언트가 변경 못 함 (tampering 방지 + 학습 commitment 일관성). 다른 만다라 검색하려면 mandala selector 로 이동.

**Refine inputs**:
- **chip 추가**: 자동완성 source = (a) mandala subjects (1순위) + (b) user signal 기반 인기 keyword + (c) recent history. chip 최대 5개 권장.
- **필터 5종**:
  - 도메인 → `youtube-provider.ts` DOMAIN_TITLE_KEYWORDS 매핑
  - 언어 → YouTube API `relevanceLanguage` + 기존 Tier-2 lang post-filter
  - 기간 → `publishedAfter`
  - 길이 → YouTube `videoDuration` (short/medium/long)
  - 정렬 → relevance / date / viewCount
- 변경 → debounce 300ms → 자동 재검색.

**BE endpoint**:
```
POST /api/v1/mandalas/:mandalaId/discover-more
body: {
  extraKeywords: string[]
  filters: {
    domain?: string
    lang?: 'ko' | 'en'
    publishedAfter?: ISO date
    duration?: 'short' | 'medium' | 'long'
    sort?: 'relevance' | 'date' | 'viewCount'
  }
  excludeVideoIds: string[]  // 이미 만다라에 있는 + archived 누적
}
returns: cards[]  (signal-personalized via hybrid-rerank Phase 4)
```
- 서버에서 mandala 의 `center_goal` resolve → keyword-builder 에 base 로 주입 + `extraKeywords` concat.
- 기존 `runDiscoverEphemeral` 재사용. excludeVideoIds 는 candidate-supply 단계에서 제외.

**Heart cross-panel transfer**:
- right panel 의 card heart 클릭 → 시각적으로 카드가 왼쪽으로 이동 animation (~400ms)
- 만다라 grid 빈 셀에 자동 정착 또는 scratchpad 에 stage
- 동시에 `POST /like` 로 v2 trigger
- mental model: "발견한 영상이 내 큐레이션으로 흡수"

**Archive**:
- right panel 에서 즉시 fade-out + signal 누적
- excludeVideoIds 에 추가 → 다음 검색 결과에서 자동 제외

**산업 매핑**:
| 패턴 | 사례 |
|---|---|
| Slide-in side panel | Notion peek / Linear issue / Slack thread |
| Locked base query + facet refine | Amazon filters / Pinterest "refine" / YouTube chips / GitHub qualifier search / Notion DB filter / Google Tools |

**기존 인프라 재사용**: Insighta 의 CopilotKit Chat panel (`ChatAssistant.tsx`) 이 동일 slide-in 패턴. transition/backdrop/Esc 로직 재활용 가능. 새 `DiscoverPanel.tsx` 만 추가.

**미결**:
| # | 결정 |
|---|---|
| 1 | chip 자동완성 source — mandala subjects 만 / + 시그널 기반 인기 keyword / + history |
| 2 | 필터 5종 중 v1 에 포함할 항목 (전체 vs 도메인+언어+기간 3종부터) |
| 3 | 필터 prefab — "최근 한 달", "30분 이상 강의" 등 1-click preset chip 도입 여부 |
| 4 | 키워드 chip 최대 개수 (3개 / 5개 / 무제한) |
| 5 | Panel 폭 — 40% / 45% / fixed 480px |
| 6 | Heart cross-panel transition 강도 — 강한 motion vs minimal |
| 7 | Stacked nesting depth limit — 2 vs 3 |
| 8 | Mobile breakpoint — 어느 폭 이하 full-screen 으로 |

**우선순위 비교 (사용자 결정 필요)**:
- 이 feature (preference signal) — 학습 UX 의 핵심, 즉시 효과 (재검색 품질)
- chatbot-transcript paid scraper (Supadata 등) — prod 챗봇 transcript 안정화, 사용자 본 세션 검증된 실패 path
- mandala sharing Phase 0 (defensive deleteMandala fix, 30분) — 사용자가 직접 보고한 500 unblock
- mandala sharing Phase 1+ (tenancy gap close + 두 모드 + collab) — 협업 기능 본격화

---

## 9. References / File Pointers

- `frontend/src/widgets/card-grid/` 또는 `frontend/src/entities/card/ui/` — 카드 컴포넌트 (정확 path 확인 필요)
- `src/skills/plugins/video-discover/v3/hybrid-rerank.ts` — reranker (Phase 4 변경)
- `src/skills/plugins/video-discover/v3/executor.ts` — 검색 엔진 (signal 주입 위치)
- `src/modules/skills/rich-summary.ts` `enrichRichSummary()` — Heart trigger 호출 대상
- `src/config/rich-summary.ts` — `RICH_SUMMARY_ENABLED` 플래그
- 본 세션 관련 핸드오프:
  - `docs/runbook/chatbot-transcript-handoff-2026-05-15.md` — Part B (background v2 trigger) 와 mechanism 공유. 본 handoff 의 Heart trigger 가 user-driven 버전.
  - `docs/runbook/mandala-sharing-collab-handoff-2026-05-15.md` — closed/open mode 와 signal 격리 정책 결정 시 cross-ref.

CLAUDE.md Hard Rules 적용:
- DB Work Order — Phase 1 의 `card_user_signals` 테이블은 raw SQL DDL 작성 + local first → PR 머지 → CI/CD prod migrate
- 계획 → 승인 → 실행 — 각 Phase plan presentation 의무
- prisma db push silent fail 대응 — raw DDL 병행 필수
