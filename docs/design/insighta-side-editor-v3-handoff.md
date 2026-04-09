# Side Note Editor v3 — CC 핸드오프

## 디자인 참조
- mockup: `insighta-side-editor-mockup-v3.html` (이 파일과 같은 폴더)
- canonical design system: `insighta-mandala-redesign-mockup.html`

---

## 구조 변경: 모달 제거 → 사이드 패널 통합

### Before (현재)
```
카드 클릭 → VideoPlayerModal (전체 오버레이)
  ├─ 영상 플레이어
  ├─ 하단 MemoEditor (textarea)
  └─ ↗ 버튼 → 별도 사이드 에디터 (Radix Sheet)
```

### After (v3)
```
카드 클릭 → 사이드 패널 슬라이드 인 (560px, 오른쪽)
  ├─ 상단: 영상 플레이어 (inline, 16:9)
  ├─ 중간: 제목 + 채널 + 시간 + 셀 배지
  ├─ 탭: [메모] [AI 요약]
  ├─ 본문: Tiptap 에디터 (또는 AI 요약 뷰)
  └─ 하단: 저장 상태 + 워드 카운트
```

VideoPlayerModal 삭제. MemoEditor 삭제. 별도 사이드 에디터 삭제.
하나의 사이드 패널이 전부 대체.

---

## 인터랙션 규칙

| 액션 | 결과 |
|---|---|
| 카드 클릭 (패널 닫힌 상태) | 패널 열림 + 해당 영상/메모 로드 |
| 카드 클릭 (패널 열린 상태) | 영상+메모 교체 (패널 유지) |
| ✕ 버튼 | 패널 닫힘 |
| ESC | 패널 닫힘 |
| 패널 밖 클릭 | 패널 유지 (닫지 않음 — 다른 카드 클릭 가능해야 하므로) |

---

## 레이아웃

```
┌─ Dashboard (flex: 1, 자연스럽게 좁아짐) ─┬─ SidePanel (560px) ──────┐
│                                           │ ┌─ 영상 16:9 ──────────┐ │
│  [카드] [카드] [카드]                     │ │        ▶        [✕]  │ │
│  [카드] [카드] [카드]                     │ └──────────────────────┘ │
│  [카드] [카드]                            │ 제목                     │
│                                           │ 채널 · 11:46 · [셀]     │
│  그리드: auto-fill, minmax(220px, 1fr)    │ ─────────────────────── │
│  → 패널 열리면 2열로 줄어듦               │ [메모] [AI 요약]        │
│                                           │ ─────────────────────── │
│                                           │ (Tiptap 에디터)         │
│                                           │                         │
│                                           │ ─────────────────────── │
│                                           │ ● 저장됨 · 3초 전  127w │
└───────────────────────────────────────────┴─────────────────────────┘
```

---

## 컴포넌트 구조

### 제거 대상
```
- VideoPlayerModal.tsx (또는 사이드 패널로 대체 후 deprecate)
- MemoEditor.tsx (사이드 패널 내 Tiptap으로 대체)
- features/side-note-editor/ (기존 오버엔지니어링 코드 전체)
```

### 신규/수정
```
features/video-side-panel/
├─ ui/
│  ├─ VideoSidePanel.tsx       # 메인 패널 컴포넌트 (Sheet side="right" width=560px)
│  ├─ PanelVideoPlayer.tsx     # 상단 영상 플레이어 (iframe embed)
│  ├─ PanelVideoInfo.tsx       # 제목 + 채널 + 시간 + 셀 배지
│  ├─ PanelNoteEditor.tsx      # Tiptap EditorContent + BubbleMenu
│  ├─ PanelAISummary.tsx       # AI 요약 탭 내용
│  └─ PanelFooter.tsx          # 저장 상태 + 워드 카운트
├─ model/
│  ├─ useVideoPanelStore.ts    # Zustand: { isOpen, videoId, open(), close() }
│  ├─ useAutoSave.ts           # debounce 1500ms
│  └─ usePanelNoteQuery.ts    # React Query GET/PATCH
└─ index.ts
```

### 기존 파일 수정
```
1. App.tsx — <VideoSidePanel /> 전역 마운트 (1줄)
2. 카드 컴포넌트 — onClick → useVideoPanelStore.open(videoId)로 변경
   (기존 modal.openModal → panel.open)
3. schema.prisma — user_note_json JSONB 추가 (1줄)
4. server.ts — 라우트 등록 (1줄)
```

---

## 영상 플레이어 구현

```tsx
// PanelVideoPlayer.tsx
function PanelVideoPlayer({ videoId }: { videoId: string }) {
  const youtubeId = extractYoutubeId(videoId); // 기존 유틸 재사용
  
  return (
    <div className="w-full aspect-video bg-black relative">
      <iframe
        src={`https://www.youtube.com/embed/${youtubeId}?autoplay=1`}
        className="w-full h-full"
        allow="autoplay; encrypted-media"
        allowFullScreen
      />
      <button onClick={onClose} className="absolute top-2 right-2 ...">✕</button>
    </div>
  );
}
```

- autoplay=1: 패널 열리면 바로 재생
- 다른 카드 클릭 시 iframe src만 교체 → 영상 전환
- ✕ 클릭 시 패널 전체 닫힘

---

## Tiptap 에디터 (기존 설계 유지)

### Extensions (MVP)
```
StarterKit (H1-3, bold/italic, bullet/ordered list, inline code)
Placeholder ("메모를 작성해보세요…")
Link (openOnClick: false, autolink: true)
CodeBlockLowlight
```

### 제외 (Phase 2)
```
TimestampNode (커스텀 extension)
Image
YouTube embed
```

### BubbleMenu
텍스트 선택 시 플로팅 툴바:
```
[B] [I] [</>] | [H2] [H3] | [•] [1.] | [🔗]
```

스타일: backdrop-blur + shadow, border-border/8, rounded-8px

---

## 탭 구조

### [메모] 탭 (기본)
- Tiptap 에디터
- contenteditable, 자동 저장

### [AI 요약] 탭
- video_rich_summaries 데이터 표시 (read-only)
- 섹션: 요약 / 키워드 (태그) / 핵심 인사이트
- AI 요약이 없으면: "아직 AI 요약이 생성되지 않았어요" placeholder

---

## API (기존 설계 유지)

```
GET /api/v1/videos/:videoId/notes/rich
  → { videoId, video: { title, channel, duration_sec, thumbnail },
      note: TiptapJSON | null, isLegacy: boolean, updatedAt }

PATCH /api/v1/videos/:videoId/notes/rich
  body: { note: TiptapJSON }
  → dual-write: user_note_json (JSONB) + user_note (plain text extract)
  → 200 { updatedAt }
```

---

## DB (기존 설계 유지)

```sql
ALTER TABLE public.user_video_states
  ADD COLUMN IF NOT EXISTS user_note_json JSONB;
```

Dual-write:
- user_note_json: Tiptap JSON 원본
- user_note: plain text extract (eviction 정책 호환)

---

## 저장 상태

```
idle → (타이핑) → pending → (1500ms debounce) → saving → saved
                                                           │
                                                           └─ 3초 후 idle

saving → error → (retry 클릭) → saving
```

Footer 표시:
- idle: 아무것도 안 보임
- saving: "저장 중…"
- saved: "● 저장됨 · 3초 전" (녹색 dot)
- error: "저장 실패 — 재시도" (빨간)

---

## 디자인 토큰 (mockup 기준)

```css
/* 패널 */
패널 너비: 560px
배경: var(--bg2) = #111219
보더: 1px solid rgba(255,255,255,0.04)
그림자: -12px 0 40px rgba(0,0,0,0.3)
슬라이드 애니메이션: 0.35s cubic-bezier(0.16, 1, 0.3, 1)

/* 영상 영역 */
배경: #000
aspect-ratio: 16/9
닫기 버튼: rgba(0,0,0,0.45) backdrop-blur(6px)

/* 영상 정보 */
제목: 14px, weight 700, letter-spacing -0.2px
메타: 11px, color var(--t3)
셀 배지: 10px, bg var(--is), color var(--ind), rounded 4px

/* 탭 */
12px, weight 500, active 하단 1.5px indigo 라인

/* 에디터 */
14px, line-height 1.72
h2: 16px weight 700
h3: 13px weight 700
code: JetBrains Mono 12px, bg rgba(255,255,255,0.05), color indigo
pre: bg rgba(0,0,0,0.3), rounded 8px
blockquote: 2px left border indigo/20
타임스탬프 pill: JetBrains Mono 11px, bg indigo/10, color indigo

/* 버블 툴바 */
bg: rgba(30,32,48,0.95)
border: rgba(255,255,255,0.07)
shadow: 0 5px 20px rgba(0,0,0,0.45)
backdrop-filter: blur(12px)
버튼: 26×24px, rounded 5px

/* 푸터 */
저장 dot: 4px, bg emerald
텍스트: 10px, color var(--t3)
워드카운트: JetBrains Mono 10px
```

---

## 병행 세션 충돌 회피

- 기존 side-note-editor/ 폴더 전체 제거 → 새 video-side-panel/ 생성
- VideoPlayerModal.tsx는 일단 유지 (다른 곳에서 아직 참조 가능)
  → 카드 onClick만 panel.open()으로 교체
  → 모달 참조 0이 되면 다음 PR에서 삭제
- api-client.ts 수정 안 함 (feature 내부 fetch wrapper)
- schema.prisma 1줄만 추가

---

## 검증 체크리스트

```
[ ] 대시보드에서 카드 클릭 → 패널 560px 슬라이드 인
[ ] 영상 자동 재생
[ ] 제목/채널/시간/셀 배지 정상 표시
[ ] 메모 탭: Tiptap 에디터 렌더, 커서 자동 포커스
[ ] 타이핑 → 1.5초 후 자동 저장 → "저장됨" 표시
[ ] AI 요약 탭 전환 → video_rich_summaries 표시
[ ] 다른 카드 클릭 → 영상+메모 교체 (패널 유지)
[ ] ✕ 클릭 → 패널 닫힘
[ ] ESC → 패널 닫힘
[ ] 대시보드 그리드가 패널 열림에 따라 자연스럽게 리플로우
[ ] Legacy plain text 메모 → paragraph wrap으로 정상 로드
[ ] 빈 메모 → placeholder 표시
[ ] 메모 전부 삭제 → dual-write NULL 저장 → eviction 대상 복귀
```
