# Settings > Integrations — 최종 기획서 v4

> 참고 기획서. 목업 v4 + 이후 논의 전체 반영.
> 목업 파일: `insighta-settings-integrations-mockup-v4.html`
> 작성일: 2026-03-27

---

## 1. 현재 상태 및 문제

### Regression (긴급)
- 기존 등록된 플레이리스트 목록이 표시되지 않음
- "Import from YouTube" 껍데기 UI (동작 안 함)
- Channels / Hashtags 탭 i18n(한글) 미적용

### 구조적 문제
- Playlists / Channels / Hashtags 3개 탭이 기획 없이 추가됨
- YouTube OAuth 연결 화면 없음
- Hashtags가 Settings에 위치 (콘텐츠 탐색 기능 → Settings에 부적합)
- "연동 설정" 하나에 모든 기능이 때려넣어져 페이지가 과도하게 길어짐

---

## 2. 새 구조

### 2-1. 사이드바 변경

```
기존                          →   변경
워크스페이스                       워크스페이스
└── 연동 설정 (전부 때려넣음)       ├── 만다라
                                  ├── 소스 관리      ← 자주 사용
                                  └── 연결된 서비스   ← 한 번 설정
```

**분리 원칙**: 사용 빈도가 다른 기능은 같은 페이지에 넣지 않는다.

### 2-2. 소스 관리 아이콘

트레이 + 위에서 화살표 내려오는 형태 (A+B 조합 #1):
```svg
<path d="M12 3v9"/>
<path d="M9 9l3 3 3-3"/>
<path d="M21 15H16l-2 3H10l-2-3H3v4a2 2 0 002 2h14a2 2 0 002-2v-4z"/>
```
"콘텐츠가 들어오는 곳"이라는 의미가 직관적으로 전달됨.

### 2-3. 페이지별 역할

| 페이지 | 역할 | 사용 빈도 |
|--------|------|-----------|
| **소스 관리** | 등록된 소스 카드 목록 + 필터 + "소스 추가" 버튼 → 모달 | 자주 |
| **연결된 서비스** | YouTube OAuth + LLM API 키 + 동기화 설정 | 한 번 |

---

## 3. 소스 관리 페이지 (Screen 1)

### 3-1. 레이아웃

```
┌─────────────────────────────────────────────────────┐
│ 소스 관리                              [+ 소스 추가] │
│ 플레이리스트, 채널, 해시태그를 등록하고 동기화합니다    │
│                                                     │
│ [전체 8] [플레이리스트 3] [채널 3] [해시태그 2]        │
│                                                     │
│ ┌─ 소스 카드 목록 (스크롤 영역) ──────────────────┐  │
│ │ 📋 온라인비즈니스 학습  playlist 23개 [↻][⏸][🗑] │  │
│ │ 📺 Brian9            channel 128개 [↻][⏸][🗑] │  │
│ │ #  bitcoin           hashtag  12개 [↻][⏸][🗑] │  │
│ │ 📋 AI 트렌드 (일시정지)       12개 [재개][🗑]   │  │
│ └─────────────────────────────────────────────────┘  │
│                  [↻ 전체 동기화]                      │
└─────────────────────────────────────────────────────┘
```

### 3-2. 소스 카드 정보

| 항목 | 내용 |
|------|------|
| 아이콘 | 타입별 D 스타일 모노 라인 |
| 이름 | 소스 이름 (최대 1줄, 말줄임) |
| 타입 라벨 | playlist / channel / hashtag (badge) |
| 영상 수 | N개 영상 |
| 동기화 시간 | 2시간 전 / 동기화된 적 없음 |
| 상태 | 활성 / 일시정지 (Paused: 흐리게 + 취소선) |
| 액션 | 동기화(↻) / 일시정지(⏸) 또는 재개(▶) / 삭제(🗑) |

### 3-3. 대량 소스 대응

| 소스 수 | UI 대응 |
|---------|---------|
| 1~4개 | 목록 그대로, 필터 없음 |
| 5~9개 | 스크롤 (max-height: 360px) + 타입별 필터 칩 |
| 10개+ | 스크롤 + 필터 + 검색 입력 자동 표시 |
| 20개+ | 가상 스크롤 (react-window) 검토 |

---

## 4. 연결된 서비스 페이지 (Screen 2)

3개 카드로 구성:

### 4-1. YouTube 카드
- OAuth 미연결: "연결하기" 버튼 + 안내
- OAuth 연결됨: 이메일 + 연결일 + "연결 해제" 버튼
- **원칙**: 미연결 시 "내 YouTube" 기능 숨김. 껍데기 UI 절대 표시 안 함.

### 4-2. LLM API 키 카드
- 등록된 키 표시 (마스킹) + 변경/삭제
- 키 추가 입력 (Provider 선택: OpenRouter / OpenAI / Anthropic / Google AI)
- AES-256-GCM 암호화 저장 안내

### 4-3. 동기화 설정 카드
- 자동 동기화 간격 (수동 / 1h / 6h / 12h / 24h)
- 백그라운드 동기화 (ON/OFF)
- AI 요약 자동 삽입 (ON/OFF)

---

## 5. 소스 추가 모달 — 2단계 플로우

### 5-1. Step 1: 소스 타입 선택 (Screen 3)

```
┌─ 소스 추가 ───────────────────────────── [×] ─┐
│ [1] 소스 선택  ›  2  상세 입력                  │
│                                               │
│ 사용 가능                                      │
│ ┌─────────┐ ┌─────────┐ ┌─────────┐           │
│ │ YouTube │ │   URL   │ │   RSS   │           │
│ └─────────┘ └─────────┘ └─────────┘           │
│                                               │
│ 예정                                           │
│ ┌─────────┐ ┌─────────┐ ┌─────────┐           │
│ │LinkedIn │ │ Notion  │ │X/Twitter│           │
│ ├─────────┤ ├─────────┤ ├─────────┤           │
│ │  파일   │ │ Pocket  │ │Podcast  │           │
│ └─────────┘ └─────────┘ └─────────┘           │
└───────────────────────────────────────────────┘
```

**플러그인 아키텍처**: 새 소스 타입 = 이 그리드에 카드 1개 등록. 기존 코드 변경 없음.

### 5-2. Step 2: YouTube 서브타입 → 입력 폼 (Screen 4)

YouTube 선택 후 4가지 서브타입:

| 서브타입 | 입력 | 설명 |
|---------|------|------|
| 플레이리스트 | URL 입력 | 공개 플레이리스트 추가 |
| 채널 | 채널명 검색 또는 URL | 검색 결과에서 선택 (Curator 스타일) |
| 해시태그 | 키워드 입력 | YouTube 검색 결과 주기적 동기화 |
| 내 YouTube | OAuth 필요 | 내 플레이리스트/구독 채널 체크박스 선택 |

클릭 시 해당 입력 폼으로 전환 (인터랙티브).

---

## 6. 소스 → 카드 → 만다라 배치 플로우

### 6-1. 전체 플로우

```
소스 추가 → 영상 동기화 → 카드 생성 → AI 자동 분류 → L2 셀 배치
                         (자동 fetch)  (@소스명 태깅)   (자막/제목 분석)

         사용자는 여기까지 아무것도 안 함
─────────────────────────────────────────────────────────
         확인 경험 (Grid View)

         체크박스 [소스 보기] 클릭 → 소스별 칩으로 전환
         @테크피드 선택 → 해당 소스 카드만 필터링
         미니맵에서 분포 확인
```

### 6-2. 소스 자동 태깅

- 소스에서 동기화된 카드에 `@소스명` 태그 자동 부여
- 채널/플레이리스트 소스: `@테크피드`, `@Brian9`, `@투자리서치`
- 해시태그 소스: `#bitcoin`, `#비트코인` (해시태그는 # 유지)

### 6-3. AI 자동 분류

- 영상의 제목/설명/자막을 분석
- 현재 만다라의 L2 셀 주제와 매칭
- 가장 적합한 셀에 자동 배치
- 사용자 개입 불필요

### 6-4. 수동 매핑 (고급, 선택적)

- Settings에서 ON/OFF 옵션 (기본 OFF)
- 소스 관리 페이지에서 소스별 L2 셀 수동 지정
- 미니맵 3×3 그리드 클릭으로 셀 선택
- 고급 사용자용

---

## 7. Grid View 상단 — 소스 필터 통합

### 7-1. 핵심 원칙

- 기존 2줄 구조 유지 (제목 행 + 필터 칩 행)
- 새 줄 추가 없음
- 줄바꿈 없음, 넘치면 가로 스크롤

### 7-2. 구현: 체크박스 1개 추가

```
기존:
All 12  #관심 2  #Python 3  #머신러닝 2  #MLOps 1  #논문 1  ...

변경 (체크 OFF — 기존 그대로):
[ㅁ 🔽] | All 12  #관심 2  #Python 3  #머신러닝 2  #MLOps 1  ...

변경 (체크 ON — 소스 칩으로 전환):
[☑ 🔽] | All 12  @테크피드 4  @Brian9 3  #python 2  @소수몽키 1  ...
```

- 칩 행 맨 앞에 소스 아이콘(트레이+화살표) + 체크박스
- 체크 OFF: 기존 섹터 칩 (#L2 이름)
- 체크 ON: 소스 칩 (@채널명, #해시태그)
- 같은 줄, 같은 공간에서 전환
- 체크박스에 **툴팁**: "내가 추가한 소스 보기"

### 7-3. 섹터 vs 소스 네이밍 구분

| 유형 | 접두사 | 예시 | 의미 |
|------|--------|------|------|
| 섹터 (L2) | # | #관심, #Python, #머신러닝 | 만다라 구조 |
| 소스 — 채널/플레이리스트 | @ | @테크피드, @Brian9 | 콘텐츠 출처 |
| 소스 — 해시태그 | # | #bitcoin, #비트코인 | 키워드 검색 소스 |

- `@` = 채널/플레이리스트 (사람/출처)
- `#` = 해시태그 키워드 소스
- 섹터(L2)는 `#` 접두사 + 만다라 셀 이름이므로 소스의 `@`와 자연스럽게 구분

### 7-4. 소스 필터 선택 시 동작

- `@테크피드` 칩 클릭 → 해당 소스에서 온 카드만 필터링
- 카드 수가 해당 소스 기준으로 변경
- 미니맵에서 해당 소스 카드가 있는 셀만 하이라이트 (숫자 표시)
- "내 소스에서 온 콘텐츠가 만다라 어디에 분포되어 있는지" 한눈에 확인

---

## 8. 플러그인 아키텍처

### 8-1. 원칙

- 새 소스 타입 추가 시 **기존 모듈에 영향 없음**
- 각 소스 타입은 **독립 모듈**로 등록
- 소스 관리 페이지와 추가 모달은 **레지스트리에서 동적으로 읽음**

### 8-2. 코드 구조

```
src/features/sources/
├── registry.ts              ← 소스 타입 레지스트리 (여기만 수정)
├── types.ts                 ← SourceType, SourceConfig 인터페이스
├── components/
│   ├── SourceListPage.tsx    ← 소스 관리 페이지
│   ├── AddSourceModal.tsx    ← 소스 추가 모달
│   └── SourceCard.tsx        ← 소스 카드 컴포넌트
├── adapters/
│   ├── youtube/
│   │   ├── index.ts          ← YouTubeSourceAdapter
│   │   ├── YouTubeSubTypes.tsx
│   │   ├── PlaylistForm.tsx
│   │   ├── ChannelForm.tsx
│   │   ├── HashtagForm.tsx
│   │   ├── MyYouTubeForm.tsx
│   │   └── icon.svg
│   ├── url/
│   │   ├── index.ts
│   │   ├── URLForm.tsx
│   │   └── icon.svg
│   └── rss/
│       ├── index.ts
│       ├── RSSForm.tsx
│       └── icon.svg
```

### 8-3. 레지스트리

```typescript
interface SourceTypeConfig {
  id: string;
  name: string;
  description: string;
  icon: React.ComponentType;
  available: boolean;
  FormComponent: React.ComponentType;
  subTypes?: SubTypeConfig[];
}

// registry.ts — 새 소스 추가 시 여기에 한 줄만 추가
export const sourceRegistry: SourceTypeConfig[] = [
  youtubeConfig,
  urlConfig,
  rssConfig,
];
```

### 8-4. 새 소스 추가 절차

1. `adapters/새소스/` 디렉토리 생성
2. Adapter + Form + Icon 작성
3. `registry.ts`에 한 줄 추가
4. 끝. 기존 코드 변경 없음.

---

## 9. 아이콘 스타일 규칙

### D 스타일 모노 라인

| 규칙 | 값 |
|------|-----|
| stroke-width | 1.3px |
| stroke | currentColor |
| fill | none |
| stroke-linecap | round |
| stroke-linejoin | round |
| viewBox | 0 0 24 24 |
| 아이콘 박스 | 40×40 rounded-10px, background: bg-surface |
| 배경 | 단색 다크 서피스 (브랜드 컬러 배경 안 씀) |

### 구현 방식

```html
<!-- SVG symbol 정의 (페이지 상단, display:none) -->
<svg style="display:none">
  <symbol id="i-source" viewBox="0 0 24 24">
    <path d="M12 3v9"/><path d="M9 9l3 3 3-3"/>
    <path d="M21 15H16l-2 3H10l-2-3H3v4a2 2 0 002 2h14a2 2 0 002-2v-4z"/>
  </symbol>
</svg>

<!-- 사용 -->
<svg><use href="#i-source"/></svg>
```

- 외부 CDN 의존성 없음 (Lucide 불필요)
- `stroke: currentColor`로 테마 자동 대응
- 이모지 사용 금지

---

## 10. i18n

```json
{
  "settings": {
    "sourceManagement": "소스 관리",
    "sourceManagementDesc": "플레이리스트, 채널, 해시태그를 등록하고 동기화합니다",
    "connectedServices": "연결된 서비스",
    "connectedServicesDesc": "외부 서비스 계정 연결 및 API 키 관리",
    "addSource": "소스 추가",
    "selectSource": "소스 선택",
    "detailInput": "상세 입력",
    "available": "사용 가능",
    "comingSoon": "예정",
    "selectSourceType": "어디에서 콘텐츠를 가져올까요?",
    "selectSubType": "어떤 유형을 추가할까요?",
    "registeredSources": "등록된 소스",
    "syncAll": "전체 동기화",
    "paused": "일시정지",
    "resume": "재개",
    "showSources": "내가 추가한 소스 보기"
  },
  "sources": {
    "youtube": {
      "name": "YouTube",
      "desc": "플레이리스트 · 채널 · 해시태그",
      "playlist": "플레이리스트",
      "playlistDesc": "URL로 공개 플레이리스트 추가",
      "channel": "채널",
      "channelDesc": "채널명 검색 또는 URL로 추가",
      "hashtag": "해시태그",
      "hashtagDesc": "키워드 기반 검색 결과 동기화",
      "myYoutube": "내 YouTube",
      "myYoutubeDesc": "내 플레이리스트 · 구독 채널 가져오기"
    },
    "url": { "name": "URL", "desc": "웹페이지 · 블로그 · 뉴스" },
    "rss": { "name": "RSS", "desc": "피드 구독" }
  }
}
```

---

## 11. 정책

| 항목 | 정책 |
|------|------|
| OAuth 미연결 시 | "내 YouTube" 서브타입에서 "연결된 서비스에서 설정" 안내 |
| Free 소스 수 | 플레이리스트 5 + 채널 3 + 해시태그 3 |
| Pro 소스 수 | 플레이리스트 50 + 채널 20 + 해시태그 10 |
| 동기화 간격 최소 | Free: 24h / Pro: 1h |
| 채널 동기화 범위 | 최근 50개 영상 |
| 해시태그 동기화 | YouTube Search API 결과 최근 10개 |
| 일시정지 상태 | 자동 동기화 제외, 수동 동기화 가능 |
| 삭제 시 | 소스만 삭제, 가져온 카드는 유지 (확인 다이얼로그) |
| 껍데기 UI | 동작하지 않는 UI는 표시하지 않는다 |
| 소스 자동 태깅 | 카드 생성 시 @소스명 태그 자동 부여 |
| AI 자동 분류 | 영상 제목/설명/자막 분석 → L2 셀 자동 배치 |

---

## 12. 구현 우선순위

| Phase | 내용 | 비고 |
|-------|------|------|
| **Phase 0** | Regression — 플레이리스트 목록 복원, 껍데기 제거, i18n | 긴급 |
| Phase 1 | 사이드바 분리 + 소스 관리 페이지 + 소스 추가 모달 | 단기 |
| Phase 2 | YouTube OAuth (연결된 서비스) + "내 YouTube" 서브타입 | 중기 |
| Phase 3 | 채널 검색 + 소스 일시정지/재개 | 중기 |
| Phase 4 | Grid View 소스 필터 체크박스 + @태그 자동 부여 | 중기 |
| Phase 5 | AI 자동 분류 (L2 셀 배치) | 중기 |
| Phase 6 | 대량 소스 대응 (필터 + 검색 + 가상 스크롤) | 필요시 |
| Phase 7 | 추가 소스 타입 (URL, RSS) 플러그인 | 장기 |
| Phase 8 | 소스-만다라 수동 매핑 (고급 옵션) | 장기 |

---

## 13. DB 스키마

```sql
-- 통합 sources 테이블 (플러그인 아키텍처 대응)
sources (
  id UUID PK,
  user_id UUID FK,
  type TEXT,           -- 'youtube_playlist' | 'youtube_channel' | 'youtube_hashtag' | 'url' | 'rss'
  external_id TEXT,    -- youtube_playlist_id, channel_id, keyword 등
  name TEXT,
  metadata JSONB,      -- 타입별 추가 정보
  status TEXT,         -- 'active' | 'paused'
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
)

-- 기존 테이블 (이미 존재)
youtube_playlists (youtube_playlist_id, title, item_count, sync_status, last_synced_at)
source_mandala_mappings (source_type, source_id, mandala_id)
```

Phase 1에서 통합 `sources` 테이블로 설계할지, 기존 `youtube_playlists`를 확장할지 결정 필요.

---

## 14. Curator.io 참고 패턴

| Curator 패턴 | Insighta 적용 |
|-------------|--------------|
| 소스별 Active/Paused | 소스 카드 일시정지 상태 |
| 채널명 검색 → Channel ID 자동 추출 | Step 2 채널 검색 폼 |
| Network → Post type → Details 스텝 | Step 1 → Step 2 모달 플로우 |
| 다양한 소스 지원 (20+) | 플러그인 아키텍처 확장 |
| Free 3 소스 제한 | Tier별 소스 수 제한 |

---

## 15. 산출물 목록

| 산출물 | 파일 | 내용 |
|--------|------|------|
| 기획서 | `settings-integrations-youtube-redesign-v4.md` | 이 문서 |
| 목업 | `insighta-settings-integrations-mockup-v4.html` | 4 Screen HTML (D스타일 인라인 SVG) |
