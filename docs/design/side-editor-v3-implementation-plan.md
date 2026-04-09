# Side Editor v3 — Implementation Plan (Dual Mode)

## Context

v1/v2는 15회 패치 실패 ("땡질맨"). 근본 원인: Radix Dialog 충돌, 잘못된 API 설계, 트리거 위치 오판.
v3는 유저가 제공한 **목업(`insighta-side-editor-mockup-v3.html`) + 핸드오프(`insighta-side-editor-v3-handoff.md`)**를 SSOT로 삼아 구현한다. **핸드오프 문서가 이 플랜보다 우선.**

**핵심**: 듀얼 모드 — VideoPlayerModal 유지 + 사이드 패널 공존.

---

## Architecture: Dual Mode

```
Mode A (Popup, 기본):
  카드 클릭 → VideoPlayerModal (전체 오버레이, Radix Dialog)
    ├─ YouTubePlayer (iframe)
    ├─ 하단 MemoEditor (textarea, 기존)
    └─ ↗ 확장 버튼

Mode B (Sidebar, 확장):
  ↗ 클릭 → 모달 닫힘 + VideoSidePanel (560px, 우측 슬라이드)
    ├─ 상단: 영상 플레이어 (iframe embed, 16:9)
    ├─ 중간: 제목 + 채널 + 시간 + 셀 배지
    ├─ 탭: [메모] [AI 요약]
    ├─ 본문: Tiptap 에디터 (또는 AI 요약 뷰)
    └─ 하단: 저장 상태 + 워드 카운트

패널 ✕ 닫기 → Popup 모드 복귀
```

---

## 인터랙션 규칙 (듀얼 모드)

### Mode A (Popup) — 기본

| 액션 | 결과 |
|---|---|
| 카드 클릭 | VideoPlayerModal 팝업 열림 (기존 동작 그대로) |
| 모달 ✕ / ESC / overlay 클릭 | 모달 닫힘 |
| 모달 내 ↗ 확장 버튼 클릭 | **Mode B로 전환**: 모달 닫힘 + 사이드 패널 열림 |

### Mode B (Sidebar) — 확장

| 액션 | 결과 |
|---|---|
| 패널 열림 시 | 대시보드 리플로우 (calc(100% - 560px)) |
| 카드 클릭 (패널 열린 상태) | 영상+메모 교체 (패널 유지, 모달 안 열림) |
| 패널 ✕ 클릭 | 패널 닫힘 → **Mode A 복귀** |
| ESC | 패널 닫힘 → Mode A 복귀 |
| 패널 밖 클릭 | **패널 유지** (닫지 않음 — 다른 카드 클릭 가능해야 하므로) |

### Mode 전환 + MemoEditor 숨김 처리

- **↗ 클릭 시**: 모달의 하단 MemoEditor 사라짐 → 사이드 패널로 대체
- **패널 ✕ 닫기 시**: MemoEditor 복귀 (모달이 다시 열리면 하단에 표시)
- MemoEditor 숨김은 Zustand mode 상태로 제어: `mode === 'sidebar'`이면 MemoEditor 렌더 skip

---

## 레이아웃

### Mode A (Popup) — 기존과 동일
```
┌─ Dashboard (100%) ───────────────────────────────┐
│                                                    │
│  [카드📝] [카드] [카드]   ← 📝 = 메모 인디케이터 │
│  [카드] [카드📝] [카드]                           │
│                                                    │
│  그리드: auto-fill minmax(220px, 1fr)             │
│                                                    │
│         ┌── VideoPlayerModal ──┐                   │
│         │  영상               │                   │
│         │  MemoEditor (↗)     │                   │
│         └─────────────────────┘                   │
└────────────────────────────────────────────────────┘
```

### Mode B (Sidebar) — 확장
```
┌─ Dashboard (flex: 1) ────────────┬─ VideoSidePanel (560px) ────┐
│                                   │ ┌─ 영상 16:9 ──────── [✕] ┐ │
│  [카드📝] [카드]                 │ │        ▶               │ │
│  [카드] [카드📝]                 │ └────────────────────────┘ │
│                                   │ 제목                       │
│  그리드 2열로 자연 축소          │ 채널 · 11:46 · [셀]       │
│                                   │ ──────────────────────────│
│                                   │ [메모] [AI 요약]          │
│                                   │ ──────────────────────────│
│                                   │ (Tiptap 에디터)           │
│                                   │ ──────────────────────────│
│                                   │ ● 저장됨 · 3초 전   127w │
└───────────────────────────────────┴──────────────────────────┘
```

**대시보드 리플로우**: 패널이 열리면 대시보드 영역이 `calc(100% - 560px)`로 줄어듦. 카드 그리드가 `auto-fill, minmax(220px, 1fr)`이면 자동으로 컬럼 수 감소.

### 📝 메모 인디케이터 (카드 UI)

- 카드 썸네일 좌하단에 `NotepadText` (Lucide) 아이콘 배지
- `card.userNote`가 비어있지 않을 때만 표시
- **이 PR 범위**: 인디케이터 UI 추가. 사이드 에디터에서 메모 저장 후 카드 인디케이터 갱신은 React Query `invalidateQueries` 또는 Zustand 낙관적 업데이트로 처리.

---

## 파일 구조

### 신규 생성: `frontend/src/features/video-side-panel/`

```
features/video-side-panel/
├─ ui/
│  ├─ VideoSidePanel.tsx       # 메인 패널 (CSS fixed div, 560px, ESC handler)
│  ├─ PanelVideoPlayer.tsx     # 상단 영상 (YouTube iframe embed + close 버튼)
│  ├─ PanelVideoInfo.tsx       # 제목 + 채널 + duration + 셀 배지
│  ├─ PanelTabs.tsx            # [메모] [AI 요약] 탭 바
│  ├─ PanelNoteEditor.tsx      # Tiptap EditorContent + BubbleMenu (기존 NoteEditor 기반)
│  ├─ PanelAISummary.tsx       # AI 요약 읽기 전용 뷰
│  ├─ PanelFooter.tsx          # 저장 상태 + 워드 카운트
│  └─ EditorToolbar.tsx        # BubbleMenu 내부 버튼 (기존 코드 이동)
├─ model/
│  ├─ useVideoPanelStore.ts    # Zustand: { isOpen, card, activeTab, open(), close(), setTab() }
│  ├─ useAutoSave.ts           # 기존 useAutoSave 복사 (1500ms debounce)
│  └─ usePanelData.ts          # React Query: GET /rich-notes/:cardId (영상 메타 + 메모 로드)
├─ lib/
│  ├─ note-parser.ts           # 기존 코드 복사 (parseRichNote, extractPlainText, isEmptyDoc)
│  └─ panel-api.ts             # fetch wrapper: GET/PATCH /rich-notes/:cardId
├─ config.ts                   # PANEL_WIDTH_PX=560, AUTO_SAVE_DEBOUNCE_MS=1500 등
└─ index.ts                    # barrel: VideoSidePanel, useVideoPanelStore
```

### 기존 코드 재사용 (복사 후 수정, import 하지 않음)

| 원본 (side-note-editor/) | 복사 대상 (video-side-panel/) | 변경 사항 |
|---|---|---|
| `model/useAutoSave.ts` | `model/useAutoSave.ts` | 동일 |
| `lib/note-parser.ts` | `lib/note-parser.ts` | 동일 |
| `lib/rich-note-api.ts` | `lib/panel-api.ts` | 상대 URL 사용 (이미 수정됨) |
| `ui/NoteEditor.tsx` | `ui/PanelNoteEditor.tsx` | 스타일 토큰 변경 (mockup 기준) |
| `ui/EditorToolbar.tsx` | `ui/EditorToolbar.tsx` | 스타일 토큰 변경 |
| `model/useNoteEditor.ts` | 내장 (PanelNoteEditor에 통합) | 분리 불필요 |
| `config.ts` | `config.ts` | WIDTH 420→560, 디자인 토큰 추가 |

### 기존 파일 수정 (5개)

| 파일 | 변경 | 줄 수 |
|---|---|---|
| `frontend/src/pages/index/ui/IndexPage.tsx` | handleCardClick 분기 (popup vs sidebar), `<VideoSidePanel>` 추가, 레이아웃 flex 래핑 | ~20줄 변경 |
| `frontend/src/widgets/video-player/ui/MemoEditor.tsx` | ↗ 버튼 onClick → `expandToSidebar(card)` 호출, `card` prop 추가 | ~10줄 변경 |
| `frontend/src/widgets/video-player/ui/VideoPlayerModal.tsx` | `card` prop을 MemoEditor에 전달 (1줄), `onCloseModal` prop 전달 | 2줄 변경 |
| `frontend/src/app/App.tsx` | `<SideEditorHost>` + `<SideEditorRouteAdapter>` 제거 → `<VideoSidePanel>` 는 IndexPage 내부에 마운트하므로 App.tsx 변경은 제거만 | 2줄 제거 |
| 카드 컴포넌트 (`CardList.tsx` 또는 해당 컴포넌트) | 📝 메모 인디케이터 배지 추가 | ~5줄 |

### 삭제 대상 (이번 PR에서 정리)

| 파일/폴더 | 이유 |
|---|---|
| `frontend/src/features/side-note-editor/` 전체 | v1/v2 코드. video-side-panel로 대체 |
| App.tsx의 `SideEditorHost` + `SideEditorRouteAdapter` import/mount | 위 폴더 삭제에 따른 정리 |
| `frontend/src/app/router/index.tsx`의 `/notes/:cardId` route | 더 이상 불필요 |

### 유지 (건드리지 않음 — 듀얼 모드이므로)

| 파일 | 이유 |
|---|---|
| `src/api/routes/video-rich-notes.ts` | API 유지 (PATCH /rich-notes/:cardId) |
| `src/modules/notes/*` | BE 서비스 유지 |
| `src/api/server.ts` | route 등록 유지 |
| `prisma/schema.prisma` | user_note_json 컬럼 유지 |
| **`VideoPlayerModal.tsx`** | **유지 — Mode A에서 사용** |
| **`MemoEditor.tsx`** | **유지 — Mode A에서 사용, ↗ 버튼 수정만** |

---

## Zustand Store 설계

```ts
// useVideoPanelStore.ts
interface VideoPanelState {
  mode: 'popup' | 'sidebar';    // 현재 활성 모드
  isOpen: boolean;               // sidebar 패널이 열려있는지
  card: InsightCard | null;      // 현재 선택된 카드 (sidebar에서 사용)
  activeTab: 'notes' | 'ai-summary';

  // Mode A: 기존 모달 동작 유지 (이 store가 제어하지 않음 — useVideoModal이 관리)
  // Mode B: 사이드 패널
  expandToSidebar: (card: InsightCard) => void;  // ↗ 클릭 → sidebar 모드 전환
  openInSidebar: (card: InsightCard) => void;     // sidebar 모드에서 다른 카드 클릭
  closeSidebar: () => void;                        // ✕ → popup 모드 복귀
  setTab: (tab: 'notes' | 'ai-summary') => void;
}
```

**`expandToSidebar(card)`**: 
1. `mode = 'sidebar'`, `isOpen = true`, `card = card`
2. 호출 직전에 모달의 `onClose()` 먼저 실행 (MemoEditor에서 처리)

**`closeSidebar()`**:
1. `mode = 'popup'`, `isOpen = false`
2. 다음 카드 클릭은 다시 모달로 열림

**`card: InsightCard` 전달 이유**: 
- `card.title` → PanelVideoInfo
- `card.videoUrl` → PanelVideoPlayer (YouTube iframe src 추출)
- `card.userNote` → PanelNoteEditor (즉시 로드, API 불필요)
- `card.id` → API cardId (저장 시)
- `card.videoSummary` → PanelAISummary
- `card.mandalaId` + `card.cellIndex` → 셀 배지

→ **별도 API GET 불필요**. 카드 데이터가 이미 프론트에 있음. 저장만 PATCH.

---

## 저장 흐름

```
PanelNoteEditor (Tiptap onUpdate)
  → useAutoSave.trigger(doc) 
  → 1500ms debounce
  → extractPlainText(doc) + doc JSON
  → PATCH /api/v1/rich-notes/:cardId  { note: TiptapJSON }
  → BE dual-write: user_note_json = JSON, user_note = plain text
```

**기존 onSave (handleSaveNote) 체인은 사용하지 않음.**
이유: handleSaveNote는 plain text만 저장. v3는 Tiptap JSON도 저장해야 함.
대신 기존 `/rich-notes/:cardId` PATCH API를 사용 (dual-write 이미 구현됨).

---

## 영상 플레이어 구현

```tsx
// PanelVideoPlayer.tsx
function PanelVideoPlayer({ videoUrl, onClose }) {
  const youtubeId = getYouTubeVideoId(videoUrl); // 기존 유틸 재사용
  
  if (!youtubeId) return <div className="aspect-video bg-black" />; // 외부 링크

  return (
    <div className="relative w-full aspect-video bg-black">
      <iframe
        src={`https://www.youtube.com/embed/${youtubeId}?autoplay=1&rel=0`}
        className="h-full w-full"
        allow="autoplay; encrypted-media"
        allowFullScreen
      />
      <button onClick={onClose} className="absolute top-3 right-3 ...">
        <X />
      </button>
    </div>
  );
}
```

- `autoplay=1`: 패널 열리면 바로 재생
- 다른 카드 클릭 시: card 교체 → iframe src 변경 → 영상 전환
- ✕: 패널 전체 닫힘
- 외부 링크 카드: iframe 대신 링크 프리뷰 표시

---

## 디자인 토큰 (mockup에서 추출)

```ts
// config.ts
export const PANEL_WIDTH_PX = 560;
export const PANEL_BG = '#111219';           // var(--bg2)
export const PANEL_BORDER = 'rgba(255,255,255,0.04)';
export const PANEL_SHADOW = '-12px 0 40px rgba(0,0,0,0.3)';
export const PANEL_TRANSITION = '0.35s cubic-bezier(0.16, 1, 0.3, 1)';
export const AUTO_SAVE_DEBOUNCE_MS = 1500;
export const SAVED_DISPLAY_MS = 3000;
export const EDITOR_PLACEHOLDER = '메모를 작성해보세요…';
```

에디터 스타일 (mockup 기준):
- 본문: 14px, line-height 1.72
- h2: 16px weight 700
- h3: 13px weight 700
- code: JetBrains Mono 12px, bg rgba(255,255,255,0.05), color indigo
- pre: bg rgba(0,0,0,0.3), rounded 8px
- blockquote: 2px left border indigo/20
- BubbleMenu: bg rgba(30,32,48,0.95), backdrop-blur(12px), border rgba(255,255,255,0.07)

---

## IndexPage 수정 상세

### Before (현재)
```tsx
// IndexPage.tsx ~line 210
const modal = useVideoModal(cards.allMandalaCards, cards.scratchPadCards);
const handleCardClick = (card) => modal.openModal(card);

// ~line 764
<VideoPlayerModal card={modal.currentModalCard} isOpen={modal.isModalOpen} ... />
```

### After (v3 듀얼 모드)
```tsx
// IndexPage.tsx
import { useVideoPanelStore } from '@/features/video-side-panel';

const panel = useVideoPanelStore();
const handleCardClick = (card: InsightCard) => {
  if (panel.mode === 'sidebar' && panel.isOpen) {
    // Mode B: 사이드바 열린 상태 → 카드 교체 (모달 안 열림)
    panel.openInSidebar(card);
  } else {
    // Mode A: 기본 → 모달 팝업
    modal.openModal(card);
  }
};

// 레이아웃: 기존 + 사이드 패널 추가
<div className="flex h-full">
  <div className="flex-1 min-w-0 overflow-auto">
    {/* 기존 대시보드 콘텐츠 전체 (모달 포함) */}
    <VideoPlayerModal ... />  {/* 유지! */}
  </div>
  <VideoSidePanel />  {/* 신규 — isOpen일 때만 560px 차지 */}
</div>
```

### MemoEditor ↗ 버튼 동작 (Mode A → B 전환)
```tsx
// MemoEditor.tsx expand button onClick:
onClick={() => {
  // 1. flush auto-save
  // 2. 모달 닫기
  onCloseModal?.();
  // 3. sidebar 모드로 전환
  useVideoPanelStore.getState().expandToSidebar(card);
}}
```

**card 객체 전달 문제**: MemoEditor는 현재 `cardId`, `videoId`, `note` 등을 개별 props로 받지만 InsightCard 전체 객체는 없음. → **VideoPlayerModal에서 `card` prop을 MemoEditor에 전달** (1줄 추가).

---

## 탭 구조

### [메모] 탭 (기본, activeTab === 'notes')
- PanelNoteEditor: Tiptap EditorContent + BubbleMenu
- 커서 자동 포커스 (패널 열릴 때 + 탭 전환 시)
- 자동 저장 (1500ms debounce)

### [AI 요약] 탭 (activeTab === 'ai-summary')
- card.videoSummary 데이터 표시 (read-only)
- 섹션: 요약 텍스트 / 키워드(태그) / 핵심 인사이트
- AI 요약 없으면: placeholder "아직 AI 요약이 생성되지 않았어요"

---

## 구현 순서 (커밋 분할)

| # | 커밋 | 파일 | 설명 |
|---|---|---|---|
| 1 | `feat(video-panel): add panel store + config` | model/useVideoPanelStore.ts, config.ts, index.ts | Zustand store (듀얼 모드) + 상수 |
| 2 | `feat(video-panel): add panel UI components` | ui/* 전체 (8 파일) | VideoSidePanel, Player, Info, Tabs, NoteEditor, AISummary, Footer, Toolbar |
| 3 | `feat(video-panel): add panel data layer` | model/useAutoSave.ts, lib/note-parser.ts, lib/panel-api.ts | 저장 + API |
| 4 | `feat(index): add dual-mode card click + sidebar layout` | IndexPage.tsx | handleCardClick 분기 + flex 래핑 + `<VideoSidePanel>` 추가 |
| 5 | `feat(modal): add expand button + card prop to MemoEditor` | MemoEditor.tsx, VideoPlayerModal.tsx | ↗ 버튼 → expandToSidebar(), card prop 전달, onCloseModal 전달 |
| 6 | `feat(cards): add memo indicator badge` | 카드 컴포넌트 | 📝 NotepadText 배지 (userNote 있을 때) |
| 7 | `remove(side-note-editor): delete v1/v2 patchwork code` | features/side-note-editor/ 전체, App.tsx import 제거, router route 삭제 |
| 8 | `test(video-panel): add unit tests` | __tests__/smoke/video-panel-*.test.ts | store (mode 전환), auto-save, note-parser |

---

## 검증 체크리스트 (듀얼 모드)

### Mode A (Popup)
```
[ ] 카드 클릭 → VideoPlayerModal 팝업 열림 (기존과 동일)
[ ] 모달 내 영상 재생 정상
[ ] 모달 내 MemoEditor (textarea) 표시 + 기존 기능 동작
[ ] MemoEditor에 ↗ 확장 버튼 표시
[ ] ↗ 클릭 → 모달 닫힘 + 사이드 패널 560px 슬라이드 인 (Mode B)
```

### Mode B (Sidebar)
```
[ ] 패널에 영상 플레이어 (iframe autoplay)
[ ] 제목/채널/시간/셀 배지 정상 표시
[ ] 메모 탭: Tiptap 에디터, 커서 자동 포커스, 보라색 외곽선 없음
[ ] 타이핑 → 1.5초 후 자동 저장 → "저장됨" 표시
[ ] AI 요약 탭 전환 → video_rich_summaries 표시 (또는 placeholder)
[ ] 다른 카드 클릭 → 영상+메모 교체 (패널 유지, 모달 안 열림)
[ ] ✕ 클릭 → 패널 닫힘 → Mode A 복귀
[ ] ESC → 패널 닫힘 → Mode A 복귀
[ ] 패널 밖 클릭 → 패널 유지 (닫지 않음)
[ ] 대시보드 그리드 자연 리플로우 (2열)
```

### 공통
```
[ ] Legacy plain text 메모 → paragraph wrap 정상 로드
[ ] 빈 메모 → placeholder 표시
[ ] 메모 전부 삭제 → dual-write NULL → eviction 대상 복귀
[ ] 📝 메모 인디케이터 배지: 메모 있는 카드에만 표시
[ ] 메모 저장 후 인디케이터 갱신
[ ] 외부 링크 카드도 패널에서 열림 (iframe 대신 링크 프리뷰)
[ ] tsc --noEmit (BE+FE) clean
[ ] vitest run green
```

---

## 리스크

| 리스크 | 완화 |
|---|---|
| 병행 세션이 IndexPage.tsx / MemoEditor.tsx 동시 수정 | IndexPage, MemoEditor 수정은 마지막 커밋, push 직전 upstream 확인 |
| Mode A↔B 전환 시 메모 데이터 불일치 (modal에서 수정 중 → sidebar로 전환) | ↗ 클릭 시 MemoEditor auto-save flush 먼저 실행 후 전환 |
| Radix Dialog (modal) + CSS div (sidebar) 동시 렌더 시 z-index 충돌 | sidebar z-[60], modal z-50. expandToSidebar가 모달을 먼저 닫으므로 동시 렌더 없음 |
| 외부 링크 카드에서 iframe 불가 | YouTube 아닌 카드는 링크 프리뷰만 표시 |
| user_local_cards 저장 실패 (rich-notes API가 user_video_states만 조회) | rich-note-service에 sourceTable 파라미터 추가하여 양쪽 테이블 지원 |
| 메모 인디케이터 갱신 지연 (저장 후 카드 배지 미갱신) | PATCH 성공 시 React Query invalidateQueries로 카드 목록 재조회 |

---

## 이번 PR에서 안 하는 것 (Phase 2)

- TimestampNode 커스텀 extension
- 슬래시 커맨드 (/timestamp, /capture)
- 이미지 붙여넣기
- YouTube embed extension
- 패널 리사이즈 (560px 고정)
- 반응형 (모바일에서 전체 화면)
- 메모 인디케이터 → 사이드 패널 직접 열기 (카드 인디케이터 클릭으로 바로 sidebar 모드 진입)
- sidebar 모드에서 watch position 저장/복구 (YouTube iframe postMessage API)
