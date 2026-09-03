# 카드는 자기 종류를 말해야 한다

2026-09-03. `linkType` 을 선택에서 필수로 올리고 `brief` 를 더한다.

## 왜

브리프 호를 만다라 카드 컴포넌트로 그리기로 했다. 그러면 한 그리드 코드가 두
종류를 다루게 되고, 섞이면 조용히 섞인다 — 만다라 격자에 호가 뜨거나, 카드
API 에 호 uuid 가 넘어가거나, 클릭 핸들러가 유튜브를 열려다 내부 경로를 받는다.

지금은 아무것도 막지 않는다. `linkType` 이 선택이라 안 넣어도 타입 검사를
통과하고, 소비 지점 13곳이 전부 `?? 'other'` 로 메꾼다. 값이 없는 카드는
`other` 가 되어 흘러간다.

새 개념을 만들 필요는 없었다. `LinkType` 이 이미
`youtube | linkedin | facebook | notion | pdf | …` 로 종류를 표기하고 있고,
여기에 `brief` 를 더하면 된다. 나중에 팟캐스트가 오면 한 줄 더다.

## 실측

작업 전에 센 것. 근거 없이 "안전하다" 고 말하지 않기 위해서다.

```
InsightCard 객체를 만드는 곳       전부 이미 linkType 을 넣고 있음
  youtubeToInsightCard             'youtube'
  recommendationToInsightCard      'youtube'
  localCardToInsightCard           card.link_type      (DB 값)
  contentEntityToInsightCard       sourceTypeToLinkType(...)
  mockData                         'youtube' ×4

DB user_local_cards.link_type      194건 전부 채워짐, null 0건

소비 지점 24곳                     직접 역참조 0건
  ?? 'other' / || 'other' 폴백     13
  card.linkType && 가드            6
  === 'youtube' 비교               3
  ?.slice() 옵셔널 체이닝          1
  .filter(Boolean)                 1
  getFileIcon switch               default 있음
```

**필수로 올려도 런타임 예외가 나는 경로가 없다.** 만드는 쪽은 이미 다 넣고
있고, 읽는 쪽은 전부 폴백이나 가드를 거친다. 타입만 관례를 따라가면 된다.

## 폴백을 지우는 이유

처음에는 13곳을 남기려 했다. "한 번에 건드리는 것보다 안전하다" 는 것이
이유였는데, 그건 이유가 아니다 — 폴백은 필수가 된 순간 도달 불가가 되므로
지워도 동작이 바뀌지 않는다.

남기면 해롭다. `card.linkType ?? 'other'` 는 **"값이 없을 수 있다"** 고 말하고,
다음 사람이 그렇게 읽는다. 그리고 그것이 이 작업이 막으려는 사고의 뿌리다 —
종류 없는 카드가 조용히 `other` 가 되어 흘러가는 경로.

## 작업

### 1. 타입

```ts
export type LinkType =
  | 'youtube' | 'youtube-shorts' | 'youtube-playlist'
  | 'linkedin' | 'facebook' | 'notion'
  | 'txt' | 'md' | 'pdf'
  | 'brief'        // NEW — 주간 브리프 한 호
  | 'other';

export interface InsightCard {
  ...
  linkType: LinkType;   // 선택 → 필수
}
```

### 2. 폴백 13곳

읽기 10곳은 폴백을 지우고 `card.linkType` 을 그대로 쓴다.
DB 로 쓰는 3곳(`local-cards:206`, `useBatchMoveCards:90`,
`useCardOrchestrator` ×4) 도 같다 — 타입이 값을 보장한다.

| 파일 | 행 |
|---|---|
| features/card-management/model/useBatchMoveCards.ts | 90 |
| features/search/model/useSearchCards.ts | 64 |
| pages/index/model/useCardOrchestrator.ts | 518 · 564 · 999 · 1421 |
| widgets/insights-view/ui/InsightsView.tsx | 128 |
| widgets/card-list/ui/DraggableCard.tsx | 117 |
| widgets/video-player/ui/ExternalLinkView.tsx | 41 |
| entities/card/model/local-cards.ts | 206 |
| entities/content/model/converters.ts | 100 |
| entities/content/ui/ContentCard.tsx | 30 |
| entities/content/ui/SourceMetaInfo.tsx | 21 |

`InsightsView:128` 만 다르다. `|| 'unknown'` 은 집계 라벨이고 `LinkType` 이
아니다. 필수가 되면 `card.linkType` 을 그대로 쓴다.

**테스트 픽스처의 `?? 'youtube'` 는 남긴다.**
`__tests__/smoke/newly-synced-cards.test.ts:37` 은 부분 입력을 받아 카드를
조립하는 빌더이고, 프로덕션 폴백이 아니다. 지우면 모든 픽스처가 `linkType` 을
명시해야 하는데, 그건 이 작업이 막으려는 사고와 무관한 비용이다. 폴백 grep 이
0 이 아닌 이유가 여기 있다 — 남은 1건은 의도된 것이다.

### 3. 종류 가드

`entities/card/lib/card-kind.ts`. `keepKind(cards, accepts, surface)` 가 맞지
않는 카드를 빼고 한 줄 로그를 남긴다 — 카드마다가 아니라 호출마다 한 줄이다.
한 번 잘못된 응답은 보통 여러 장을 싣고 오고, 같은 줄 마흔 개가 찍힌 콘솔은
아무도 읽지 않는다.

| 표면 | 받는 것 | 적용 지점 |
|---|---|---|
| 만다라 그리드 | `linkType !== 'brief'` | `CardListView.tsx` `effectiveCards` |
| 브리프 그리드 | `linkType === 'brief'` | `BriefCategoryPage.tsx` |

로그 문구는 "표시 결함이 아니라 데이터 결함" 이라고 말한다. 잘못된 카드가
그려지는 건 화면 버그처럼 보이지만 원인은 상류에 있기 때문이다.

### 4. id 공간

호 카드의 id 는 `brief:<slug>`. 카드 API 의 uuid 검증이 잘못된 호출을 400 으로
거절한다 — 로그보다 강한 방어다. 이쪽이 본 방어선이다: 이 파일이 보지 못하는
곳에서 실수가 나도 유지된다.

### 5. 카드 컴포넌트의 종류 분기

`InsightCardItemV2` 안에서 호에만 다르게 도는 곳은 셋이다. 나머지는 저절로
빠진다 — 아카이브 버튼은 `mandalaId` 에, 북마크는 `videoId` 에 이미 걸려
있고 호는 둘 다 없다.

| 무엇 | 왜 |
|---|---|
| 요약 = `userNote`(dek) | 호에는 v2 essence 도 `summary_ko` 도 없다. dek 은 그 호가 요약되라고 쓰인 줄이다 |
| 날짜 = `publishedAt` | `formatCardDateLabel` 의 폴백은 "added N days ago" — 주간지에 대해 행 생성 시각을 말하게 된다 |
| Play 배지 없음 | 클릭하면 읽는 화면이 열린다. 표지가 영상 썸네일이라 배지가 있으면 재생을 약속하는 셈 |
| 메모 아이콘 없음 | 그 글리프는 "내가 여기 뭘 적었다" 는 뜻이다. dek 은 간행물의 글이다 |

## 판정

| 조건 | 결과 |
|---|---|
| `npx tsc --noEmit` 프론트·백 양쪽 통과 | 0 / 0 |
| `linkType` 폴백 grep 0건 | 프로덕션 0건 (테스트 픽스처 1건은 의도) |
| 기존 테스트 무회귀 | 524/524 |
| 종류 가드 단위 테스트 | 12/12 (`card-kind.test.ts`) |
| `vite build` | 통과 |
| hardcode-audit | baseline 과 동일, 신규 위반 0 |
| 기존 카드 화면이 실제로 렌더됨 | **프로드 확인 필요 — 미완** |
| 섞이면 로그 | 단위 테스트로 확인, 프로드 미발생 |

## 롤백

`git revert`. DB 변경이 없다 — 새 컬럼도 새 테이블도 없고, `/brief/subscribed`
응답에 필드 둘(`dek`·`coverVideoId`)이 늘었을 뿐이라 구버전 프론트가 받아도
무시한다.
