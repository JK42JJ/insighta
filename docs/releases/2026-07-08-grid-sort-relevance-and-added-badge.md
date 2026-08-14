# 릴리즈 노트 — 2026-07-08: 그리드 정렬 3필 복원(관련도순 기본) + 관련도 백필 + "추가됨" 배지

> **세션 별칭: `정렬-관련도-배지`** (동시 다중 세션 구분용 — 그날 이 세션의 메인 작업)
>
> 세션 단위 릴리즈 기록. 이후 작업 참고용 — 무엇이 왜 바뀌었고, 무엇이 남았는지.
> 작성 규칙: 위 = 자연어(읽고 이해), 아래 = 기술 상세(구현 참고).

---

## 한눈에 보기

이번 릴리즈의 중심은 **"카드 그리드가 관련도 순으로 정렬된다"** 입니다. 정렬 옵션이 승인
설계 원안인 **[관련도순(기본) · 최신순 · 조회수] 3필**로 복원됐고, 관련도순이 기본값이 됐습니다.
그런데 그동안 관련도 점수를 가진 카드가 전체의 **5.7%뿐**이라 관련도순이 사실상 무의미했는데,
이번에 pgvector로 **57.6%까지 백필**(4,515행)해서 관련도순이 실제로 동작하게 만들었습니다.

함께, 카드에 **"추가됨" 배지**가 붙습니다 — 단, 만다라 생성 시 자동으로 채워진 카드가 아니라
**사용자가 직접 추가한 카드에만** 48시간 동안. (배지가 전 카드에 붙던 버그를 근본 신호로 수정.)

---

## 무엇이 바뀌었나 (사용자 관점)

### 1. 그리드 정렬 3필 복원 — 관련도순 기본
- 정렬 = **[관련도순(기본) · 최신순 · 조회수]**. 전역 적용(모든 만다라 공통), 첫 변경 시 안내 토스트.
- 관련도 점수가 없는 카드는 **최하단으로 밀리지 않고** 최신순 기반으로 자연스럽게 섞임(recency 폴백).

### 2. 관련도 백필 — 5.7% → 57.6%
- 서빙된 카드의 관련도 점수를 pgvector 코사인으로 채움(4,515행). 관련도순이 실제 의미를 가짐.
- 나머지(임베딩 없는 라이브 카드)는 recency 폴백. 서빙 랭킹·게이트는 무접촉(표시 전용 필드).

### 3. "추가됨" 배지 — 직접 추가한 카드만
- 사용자가 like/pin 또는 "카드 추가" 패널에서 **직접 담은 카드**에만 48시간 배지.
- 만다라 생성·자동 추천으로 유입된 카드는 배지 없음.
- 위치: 썸네일 우상단 재생시간 **하단**(세로 스택).

---

## 왜 바꿨나 (측정 근거)
- 관련도순 기본 전환의 전제 = 커버리지. 백필 전 5.7% → 관련도순이 NULL-default로 무의미. 백필 후 57.6%.
- "추가됨" 배지 버그: James 만다라 50카드가 **전부 `auto_added=true`**(생성 시각 일괄 추가)라 `createdAt<48h` 게이트가 전 카드에 걸림 → prod DB 실측 후 `auto_added=false`(사용자 명시 액션) 신호로 수정.

## 알려진 한계 · 백로그
- 관련도 커버리지 57.6% — 임베딩 없는 라이브 카드는 recency 폴백(관련도 점수 아님).
- **watch-progress(시청 이어보기 + 진행률 바)**: 설계 완료(`docs/design/watch-progress-resume-2026-07-08.md`), 승인 후 착수 예정. 학습페이지/대시보드 기본 적용, 무회귀 PR-0→1→2.

---

## 기술 상세

### PR
| PR | 내용 | SHA |
|----|------|-----|
| #1110 | P3 Stage 1 — 전역 정렬 [최신순·조회수] + NEW 배지 + view_count 필드 | `ee11a4c3` |
| #1111 | P3 Stage 2 — 3필 [관련도순 기본·최신순·조회수] 복원 + relevance 백필 배관 | `cd98e712` |
| #1112 | 배지 — 위치(재생시간 하단) + stream 카드 제외(1차) | 42ab2a87 병합 |
| #1113 | 배지 — `auto_added=false` 게이트로 근본 수정(사용자 추가만) | `66404a8f` |

### 데이터 작업 (별도 prod 실행)
- relevance 백필: `round(cosineToRelevance(0.5·centerScore + 0.5·bestCellScore) × 100)`, center-gate 보존(평균 후 1회 적용).
- center = `mandala_embeddings` level 0(getCenterGoalEmbedding 워밍 159), cell = level 1, video = `video_pool_embeddings`.
- 3분해: WARM 159/159/0 · RC 4515/4515/0 · ULC 160 NULL→21 성공(139 미임베딩=recency 폴백). 기존 non-NULL 불가침.
- 커버리지 5.7% → 57.6%(rec_cache 4515/7834), 배포 후 재측정 동일 생존.

### 스키마 (additive, CP499+ 준수)
- `recommendation_cache.relevance_pct Int?` — nullable additive, 표시 전용, `rec_score`에 무합산. raw SQL DDL + `apply-custom-sql.sh` allowlist 등록(Prisma client select 전 적용).

### 코드 앵커 (origin/main)
- `ContextHeader.tsx:14` SORT_OPTIONS relevance-desc 기본 · `CardListView.tsx` makeRelevanceComparator(NULL recency 폴백, cap 60) · `InsightCardItemV2.tsx` 추가됨+duration 세로 스택 + `isNew = card.autoAdded === false && createdAt<48h` · `executor.ts` placement write relevancePct(=cosineToRelevance×100) · `mandalas.ts` API relevancePct 매핑.

### 사고 · 우회 기록
- **배지 2-PR 재작업**: 1차 게이트 `id.startsWith('stream-')` 추측 → 여전히 전 카드 노출. prod DB 실측(50카드 auto_added=true) 후 `auto_added=false` 정타. → /retro sub-rule "게이트 신호 DB 실측 확정" 등재.
- **watch-progress 설계 v1 오류**: "새 컬럼+새 API" 제안 → 기존 `watch_position_seconds`·`update-video-state`·`lastWatchPosition` 전부 존재. James "코드 전체 읽어라" → 전체 정독 후 "기존 시스템 미배선" v2 재작성. → /retro sub-rule "설계 전 전체 정독" 등재.
- **P1 red herring 자가정정**: 배포/콜드스타트 가설 → 실제 로컬 :3000 죽은 API + React Query 캐시 위장. 자가정정.

### 설계 문서
- `docs/design/watch-progress-resume-2026-07-08.md`(gitignored 로컬) — watch-progress 무회귀 PR-0/1/2 계획.
