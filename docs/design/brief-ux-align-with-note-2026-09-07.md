# 브리프를 노트와 같은 자리에 놓기

2026-09-07. 설계만. 코드 수정 전.

## 무엇이 어긋났나

James 가 두 가지를 지적했다. 서로 다른 문제이고, 고치는 곳도 다르다.

**하나. 메뉴가 만다라 리스트를 밀어낸다.**

브리프 도메인 10개가 사이드바에 그대로 펼쳐진다. 만다라 12개 중 10개만 보이고
나머지는 스크롤 밖으로 나간다. `TBD` 배지 9개가 세로로 늘어서 있고, 그중 어느
것도 지금 누를 수 없다. 읽을 수 없는 항목이 읽을 수 있는 항목을 가린다.

**둘. 브리프를 읽는 동안 만다라 사이드바가 붙어 있다.**

`/brief/:slug` 는 읽는 화면인데 왼쪽에 만다라 목록이 그대로 있다. 노트
(`/learning/:mandalaId/:videoId`)는 그렇지 않다 — 그 노트의 목차가 사이드바를
대체한다. 브리프만 예외다.

**셋. 행 폭이 만다라와 다르다.**

hover 박스가 만다라보다 좌우로 4px씩 넓다. 버튼의 className 은 두 곳이 문자
단위로 같다 (`w-full … px-1.5 py-2 rounded-lg …`). 다른 것은 감싸는 구조다.

```
브리프   패널 → div px-1                = 좌우 4px
만다라   패널 → nav px-1 → div px-1     = 좌우 8px      (Sidebar.tsx:210)
```

`SidebarMandalaSection` 은 스크롤 `<nav className="… px-1 pb-2">` 안에 있어
`px-1` 을 두 번 받고, `SidebarBriefEntry` 는 그 nav 밖이라 한 번만 받는다.
className 을 아무리 맞춰도 부모가 다르면 폭이 다르다.

## 이미 있는 답 두 개

새로 발명할 것이 없다. 이 제품이 두 문제를 각각 이미 풀어 놓았다.

### `더 보기` — 팝오버

`SidebarTopSection.tsx:210` 이 정확히 그 형태다.

```
<Popover open={moreOpen} onOpenChange={setMoreOpen}>
  <PopoverTrigger asChild>
    <button>  ▾  더 보기  </button>      // 사이드바에서 한 줄
  </PopoverTrigger>
  <PopoverContent side="right" align="start" sideOffset={8}
                  className="w-80 p-1.5 max-h-[80vh] overflow-y-auto">
    <SidebarSkillPanel … />               // 목록은 여기 산다
  </PopoverContent>
</Popover>
```

사이드바는 한 줄만 내주고, 목록은 오른쪽으로 열린다. 만다라 리스트는 밀리지
않는다.

행 모양도 그쪽이 정본이다 (`SidebarSkillPanel.tsx:440~527`):

| 상태 | 표시 |
|---|---|
| 켜짐 | `w-1.5 h-1.5 rounded-full bg-emerald-500` |
| 잠김 | `opacity-40 cursor-not-allowed` + 배지 |
| 배지 | `rounded-[3px] text-[9px] font-extrabold tracking-wider` |

브리프의 `TBD` 는 스킬 패널의 `PRO` 와 같은 자리, 같은 뜻이다 — **아직 못
누른다.** 지금 사이드바에 그 배지가 아홉 개 늘어선 것이 어색한 이유는 배지가
아니라 배지가 있는 곳이다.

### 노트 — 읽는 동안의 사이드바

`Sidebar.tsx` 는 패널 셋을 겹쳐 두고 라우트로 민다.

```
Sidebar.tsx:236   isLearningRoute && !settingsMode
                    ? 'translate-x-0 opacity-100'
                    : 'translate-x-full opacity-0 pointer-events-none'
```

학습 패널 안은 세 부분이다.

```
Sidebar.tsx:245   ← 앱으로 돌아가기          (handleBackToApp)
Sidebar.tsx:258   [◧] 접기
Sidebar.tsx:276   <SidebarLearningSection mandalaId currentVideoId collapsed />
```

`SidebarLearningSection` (535줄) 이 실제 목차다. 제목 + `17개 영상에서 종합` +
장/절 트리 + 현재 절 강조.

> **주의.** `pages/learning/ui/LeftPanel.tsx` 는 **consumer 0 — dead code** 다.
> 이름만 보고 그것을 고치면 화면은 그대로다. 과거 CP519 에서 같은 착각으로
> PR 두 개를 낭비했다. 실물은 `widgets/app-shell/ui/SidebarLearningSection.tsx`.

## 설계

### A. 사이드바 메뉴 → 팝오버

`SidebarBriefEntry` 를 접이식 목록에서 **한 줄 + 팝오버**로 바꾼다.

```
사이드바 (한 줄만 차지)
  브리프                    ②  ›

  ↓ 클릭 — 오른쪽으로 열림 (side="right" align="start")

  ┌────────────────────────────────┐
  │  AI 엔지니어링              ②  │   구독 중 · 안 읽음 2
  │  개발                    TBD  │   비활성 (opacity-40)
  │  커리어                  TBD  │
  │  … (10개)                     │
  └────────────────────────────────┘
```

- 트리거 행은 `더 보기` 와 같은 높이·같은 hover. 배지는 안 읽음 합계
- **좌우 여백을 만다라와 맞춘다.** className 이 아니라 감싸는 구조를 고친다 —
  `SidebarBriefEntry` 를 `px-2` 컨테이너에 넣거나(만다라의 4+4 와 같은 8px),
  만다라 `nav` 와 같은 층에 둔다. 둘 중 어느 쪽이든 **부모까지 포함해** 계산이
  같아야 한다. 자식 className 만 비교하면 이 버그를 다시 만든다
- 팝오버 내부는 `SidebarSkillPanel` 의 행 문법을 그대로 쓴다 —
  구독 중 = 초록 점, 안 읽음 = 숫자 배지, 미발행 = `opacity-40` + `TBD`
- 클릭 → `/brief/c/:key` (카드 그리드). 미구독이면 구독 후 이동. `TBD` 는 무동작
- 사이드바 세로 점유: **10행+헤더 → 1행**

`+ 브리프 추가` 는 이미 없앴다. 열 개가 전부 팝오버에 있으므로 추가할 것이
없다.

### B. 읽기 화면 → 브리프 패널

패널을 하나 더 만드는 것이 아니라, **학습 패널이 하는 일을 브리프도 하게**
한다. `Sidebar.tsx` 의 라우트 판정에 브리프를 더한다.

```
const briefMatch = useMatch('/brief/:slug');
const isBriefRoute = Boolean(briefMatch);
```

읽기 라우트(`/brief/:slug`)에서만 참이다. `/brief/c/:key` 는 카드 그리드이므로
만다라 패널 쪽이 맞다 — 그 화면은 목록이지 읽기가 아니다.

앱 패널이 밀려나는 조건에 `isBriefRoute` 를 더하고(`Sidebar.tsx:163`), 학습
패널과 같은 자리에 브리프 패널을 놓는다. 구성은 학습 패널과 동일:

```
← 앱으로 돌아가기                    [◧]
─────────────────────────────────────
AI 엔지니어링 제1호                    ✕
274편에서 종합
─────────────────────────────────────
· 이번 주에 달라진 것
· 신뢰 경계
    Claude Code는 저장소 설정…      ← 현재
· 권한의 시점
    PayPal은 에이전트가 물건…
· 운영
· 비용
· 추천 영상 5편
· 이번 호의 용어
· 등급 원장
· 다음 호에서 확인할 것
```

**목차는 `IssueDocument` 에서 나온다.** 새 데이터가 필요 없다.

| 항목 | 출처 |
|---|---|
| 제목 | `issueLabel` + `category` |
| 부제 | `runline` 의 인용 편수 |
| 장 | `stories[].kicker` (신뢰 경계 / 권한의 시점 / 운영 / 비용 — 이미 있다) |
| 절 | `stories[].title` |
| 뒤 항목 | `picks` · `vocabulary` · `interest.ledger` · `next` 존재 여부 |

`stories[].kicker` 가 이미 장 이름 역할을 하고 있다는 것이 이 설계의 근거다.
그것을 쓰려고 만든 것처럼 맞는다.

### C. 현재 절 강조 — 나중

노트는 `useLearningStore.activeSectionRef` 로 스크롤 위치를 추적한다. 브리프도
같은 것이 필요하지만 **1차에서는 넣지 않는다.** 클릭 이동(앵커)만 하고, 스크롤
연동은 클릭이 실제로 쓰이는지 본 다음에 붙인다. 스크롤 추적은 관측 대상이 있는
기능이고, 지금은 그 관측이 없다.

## 하지 않을 것

- **`LeftPanel.tsx` 수정.** consumer 0. 고쳐도 화면이 바뀌지 않는다
- **네 번째 패널 신설.** 학습 패널과 같은 자리를 쓴다. 패널 수는 그대로
- **`SidebarLearningSection` 재사용.** 노트의 목차는 `mandala_book` 챕터
  구조를 읽는다. 브리프는 `IssueDocument` 다. 자료가 다른데 컴포넌트를 공유하면
  두 자료 모두에 맞지 않는 하나가 된다. **모양을 맞추고 코드는 나눈다**
- **우측 메모·챗봇 패널.** 브리프는 읽기 전용이고, 메모가 무엇을 뜻하는지
  (내 노트로 담기? 호에 다는 메모?) 정해지지 않았다
- **`/brief/c/:key` 의 사이드바 변경.** 카드 그리드는 목록 화면이고 만다라
  패널이 맞다

## 만들 것

| | 무엇 | 파일 |
|---|---|---|
| 1 | `SidebarBriefEntry` 를 팝오버로 | `widgets/app-shell/ui/SidebarBriefEntry.tsx` (재작성) |
| 2 | 브리프 목차 | `widgets/app-shell/ui/SidebarBriefSection.tsx` (신규) |
| 3 | 라우트 판정 + 패널 배치 | `widgets/app-shell/ui/Sidebar.tsx` |
| 4 | 본문에 앵커 id | `features/newsletter-note/lib/issue-to-note.ts` |

4가 필요한 이유: 목차를 눌러 이동하려면 본문 heading 에 id 가 있어야 한다.
지금 `issue-to-note.ts` 는 heading 을 만들지만 id 를 붙이지 않는다.

## 판정

- 사이드바에서 브리프가 차지하는 세로: **10행+헤더 → 1행**
- 브리프 행과 만다라 행의 hover 박스 좌우 끝이 **픽셀 단위로 일치** (측정으로 확인)
- 만다라 리스트가 잘리지 않는다 (12개 전부 보임)
- `/brief/:slug` 에서 만다라 목록이 보이지 않는다
- 목차 항목을 누르면 해당 절로 이동한다
- `/brief/c/:key` 는 지금과 동일 (만다라 패널 유지)
- 팝오버가 만다라 리스트를 덮지 않는다 (`side="right"`)

## 롤백

`git revert`. DB 변경 없음. 신규 파일 1개와 기존 파일 3개 수정이다.

## 승인 대기

착수 전 James 확인 필요. 특히:

- **B 의 범위** — 노트와 동일(돌아가기 + 목차 + 접기)로 확정된 것으로 이해했다
- **C 를 1차에서 빼는 것** — 스크롤 연동 없이 클릭 이동만
