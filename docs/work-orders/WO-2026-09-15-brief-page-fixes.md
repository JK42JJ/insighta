---
id: WO-2026-09-15-brief-page-fixes
status: open
owner: insighta-session
opened: 2026-09-15
---

# 목표
2호 발송 전에 브리프 목록 · 읽기 화면이 제 패널을 갖고, 호수가 한 곳(DB `issue_no`)에서만 나오며, 카드 요약에 태그가 보이지 않는다. 표지 없는 호는 카테고리 기본 표지로 폴백한다.

# 맥락
James 핸드오프(2026-09-15). 시작 SHA `1b324135` (origin/main, 2026-09-11 22:06). 브랜치 `fix/brief-panel-issue-number`, 워크트리 `~/cursor/insighta-brief`. 아래는 코드를 읽고 확정한 사실이고, 핸드오프의 추정과 다른 곳은 코드를 따랐다.

## 코드 실측 (2026-09-15)

| 항목 | 사실 | 근거 |
|---|---|---|
| 셸 구조 | `/brief/*` 는 AppShell 안에서 렌더된다(`SIDEBAR_ROUTES` 에 `/brief` 포함). Sidebar 는 `settingsMode` prop + 라우트 매치 두 가지로 패널을 고른다: 앱 패널 · 러닝 패널(`/learning/:mandalaId/:videoId`) · **브리프 패널(`/brief/:slug`, 단 `c` 제외)** · 설정 패널 | `AppShell.tsx:31-35,168` · `Sidebar.tsx:126-137,163,177,249,300` |
| 브리프 패널이 이미 있음 | `/brief/:slug` 에서는 "← 앱으로 돌아가기" + `SidebarBriefSection`(그 호의 **목차**: 스토리 · 한 문장 · 추천 · 용어 · 방법 · 출처)이 뜬다. `/brief/c/:key` 는 주석에 "목록 화면이므로 만다라 패널 유지" 라고 적혀 있어 **의도적으로 전역 패널**이 남았다 | `Sidebar.tsx:129-133`, `SidebarBriefSection.tsx` 머리 주석 |
| 러닝 패널 구조 | 헤더(← 앱으로 돌아가기 · 접기) + `SidebarLearningSection`(만다라 이름 · 챕터 목록, 현재 영상 강조). 브리프 목차와 "일부러 공유하지 않음"(다른 데이터 모양) | `Sidebar.tsx:249-295`, `SidebarBriefSection.tsx:15-18` |
| 모바일 | `MobileDrawer` 는 홈 · 프로필 · 구독 · 설정 · 도움말 링크만 있는 Sheet. 러닝 페이지도 모바일에서는 자기 패널이 없다 | `MobileDrawer.tsx:29-39` |
| 접근 | `/brief/c/:key` · `/brief/:slug` 둘 다 `ProtectedRoute` → 로그아웃이면 `/login?returnTo=` 로 이동. AppShell 은 로그아웃 시 셸 없이 children 만 렌더 | `router/index.tsx:172-188`, `ProtectedRoute.tsx:20`, `AppShell.tsx:143` |
| 호수의 출처 | DB `newsletter_issues.issue_no`(정수) + `content_json.issueLabel`(편집 문자열) 두 곳. 등록 시 `issue_no = issueNumber(doc)` = 라벨의 숫자(창간호 = 1). 목록 API 는 `content_json.issueLabel ?? '제N호'` 로 **라벨을 우선**한다. 웹 템플릿 · 노트 변환 · 메일 · 문서 제목은 전부 `doc.issueLabel` 을 읽는다 | `issue-schema.ts:213-224`, `admin/newsletter.ts:187,229`, `brief.ts:79,104`, `templates/web-v1/index.ts:109,116,298`, `issue-to-note.ts:246`, `render-note.ts:182`, `render-mail.ts:43` |
| unique 제약 | `@@unique([category_key, issue_no, locale])` 이미 있음 (`uq_newsletter_issues_category_no_locale`) — DDL 불필요 | `schema.prisma:2890` |
| prod 행 | `2026-08-25-ai-tech`: issue_no **0**, published_at 08-28 17:32, 라벨 "제1호", picks 없음(표지 없음) · `2026-09-02-ai-tech`: issue_no **1**, published_at 09-03 01:57, 라벨 "제1호", picks[0] = 1IbrFrdll4U | 2026-09-15 읽기 전용 조회 |
| 정적 사본 | `frontend/public/brief/2026-08-25-ai-tech.html` · `index.html` 이 정적 파일로 배포되어 `insighta.one/brief/2026-08-25-ai-tech.html` 로 공개된다(SPA 라우트와 별개) | 파일 존재 |
| 카드 요약 | 카드 본문 = `dek`(HTML 포함 문자열)를 `userNote` 로 그대로 전달 → 태그가 텍스트로 보임. 메일 렌더는 이미 `plain()` 으로 태그를 벗긴다 | `brief.ts:74`, `brief-card.ts:56`, `render-mail.ts:69-75` |
| 표지 | `coverVideoId = picks[0].videoId`, 없으면 `''` → 빈 자리 | `brief.ts:78`, `brief-card.ts:38-40` |
| 메일 | `renderMail`(→ `buildBriefEmail`)은 `readUrl` · `unsubscribeUrl` 을 호출자가 넘긴다. **호출자가 코드에 없다**(src · scripts 어디에도 없음). `List-Unsubscribe` 헤더도 없다. 발송 계층 `send()` 는 from · to · subject · html 만 넘긴다. 토큰 해지 라우트는 있다 | `render-mail.ts:13-18`, `transactional.ts:51-76`, `brief.ts:368` |
| 발송 원장 | `email_broadcast_sends` 의 캠페인은 `dial-launch-hancom` 10 · `dial-launch-hancom-v2` 10 · `mobile-guide` 18 (전부 2026-07-28, 서로 다른 수신자 합계 28). **브리프 캠페인은 없다.** 09-14 v6 재료 패키지에 적은 "브리프 발송 38건 · 수신자 28명" 은 이 7월 공지 캠페인을 잘못 읽은 것이다 → 사업계획서의 "창간호 28명 발송" 근거는 DB 에 없다 | 2026-09-15 pod 조회 |

# 설계

## 1. 좌측 패널 — `/brief/*` 전부에 브리프 패널

분기: 핸드오프 첫째 갈래(AppShell 안 · Sidebar 모드 분기)가 맞다. 이미 있는 브리프 패널을 **`/brief/c/:key` 로 넓히고 내용물을 바꾼다.**

- `Sidebar.tsx`: `isBriefRoute` 를 `useMatch('/brief/*')` 로 바꾸고, `categoryKey` 는 `/brief/c/:categoryKey` 매치에서, `slug` 는 `/brief/:slug` 매치에서 얻는다. 호 페이지의 카테고리는 `useBriefNote(slug).issue.categoryKey` 에서 온다(이미 패널이 그 훅을 쓴다).
- 새 컴포넌트 `SidebarBriefPanel`(widgets/app-shell/ui): 헤더 = 카테고리명 + 구독 상태 버튼(구독 중 / 구독; `brief-categories` 쿼리 재사용, 클릭 = `subscribeToBrief` / `unsubscribeFromBrief`) · 본문 = 그 카테고리의 호 목록(`brief-subscribed` 쿼리를 카테고리로 필터, 최신순, 현재 slug 강조, 안 읽음 점, 클릭 = `navigate('/brief/<slug>')`). "← 앱으로 돌아가기" 와 접기 버튼은 지금 브리프 패널 헤더를 그대로 쓴다.
- 현재 호의 목차(`SidebarBriefSection`)는 **현재 호 행 아래에 접어 넣는다**(러닝 패널의 챕터 목록 자리). 목차 스크롤 기능은 그대로.
- 만다라 목록 · 새 만다라 · 템플릿 찾기(`SidebarTopSection` · `SidebarMandalaSection` · `SidebarBriefEntry`)는 `isBriefRoute` 에서 이미 숨겨진다 — 넓힌 매치만으로 목록 페이지에서도 사라진다.
- 구독하지 않은 카테고리 페이지: 헤더의 버튼이 "구독" 이고 목록은 발행된 호를 보여 준다. 그러려면 목록 소스가 구독 조인이 아닌 **카테고리 공개 목록 API** 여야 한다 → 2절의 `GET /brief/c/:key/issues` 신설.
- 모바일: `MobileDrawer` 에 `briefContext?: { categoryKey, slug }` 를 받아 `/brief/*` 이면 `SidebarBriefPanel` 을 Sheet 안에 그대로 렌더하고, 아니면 지금 메뉴. 전역 접기 · 너비 로직은 손대지 않는다.
- 러닝 패널은 파일 단위로 건드리지 않는다(회귀 스크린샷 1장으로 확인).

## 2. 호수 — DB `issue_no` 하나에서만

- API 응답의 `issueLabel` 은 서버가 `issue_no` 로 만든다: `labelOf(issue_no, locale)` = `제N호`(ko) / `No. N`(en). `content_json.issueLabel` 은 더 이상 읽지 않는다(`brief.ts:79,104` 삭제).
- 문서 응답(`/:slug/document`) · HTML 렌더(`/:slug`) · 메일 렌더는 이미 "저장 컬럼이 문서 사본을 이긴다" 패턴(`template_version` · `locale`)을 쓴다. 같은 자리에서 `issueLabel: labelOf(row.issue_no, row.locale)` 을 덮어쓴다. 그러면 웹 템플릿 · 노트 변환 · 메일 제목 · 문서 제목이 전부 같은 값을 읽고, 렌더 코드는 바뀌지 않는다(본문 렌더러 무변경 조건 충족).
- 등록(admin): `issue_no` 는 라벨의 숫자에서 계속 오되, **"창간호" 는 1** 이라는 규칙과 unique 제약이 충돌을 막는다. 같은 카테고리 · 같은 번호로 두 번 등록하면 지금은 500(P2002) — 409 로 바꾸고 메시지에 번호를 넣는다.
- 데이터 수정(James 게이트, 되돌릴 수 있게 스냅샷 동봉):
  ```sql
  -- 스냅샷
  select id, slug, issue_no, published_at from newsletter_issues where category_key='ai-tech';
  -- 08-25 시도를 목록에서 내린다 (draft). 행은 남는다.
  update newsletter_issues set published_at = null where slug = '2026-08-25-ai-tech';
  -- 되돌리기
  update newsletter_issues set published_at = '2026-08-28 08:32:00+00' where slug = '2026-08-25-ai-tech';
  ```
  09-02 행은 issue_no 1 로 이미 맞다. 2호는 등록 시 라벨 "제2호" → issue_no 2.
- 정적 사본 `frontend/public/brief/*.html` 2개 삭제(08-25 판이 공개 경로에 남아 있는 다른 통로).
- DDL 없음. unique 제약이 이미 있으므로 마이그레이션 파일도 없다.

## 3. 카드 요약 — excerpt 생성 시점에 태그 제거

- `render-mail.ts` 의 `plain()` 을 `src/modules/newsletter/plain-text.ts` 로 옮겨 공용화(태그 제거 + 엔티티 `&amp;` `&lt;` `&gt;` `&quot;` `&#39;` 복원 + 공백 정리).
- `/brief/subscribed` 와 새 `/brief/c/:key/issues` 의 `dek` 를 `plainText(dek)` 로 내보낸다. 카드는 받은 값을 그대로 쓴다. 본문 페이지(`issue-to-note.ts:248`)는 `doc.dek` 의 강조를 그대로 렌더한다.

## 4. 표지 폴백

- 서버가 `coverUrl` 을 계산해 내보낸다: `picks[0].videoId` 가 있으면 `https://i.ytimg.com/vi/<id>/hqdefault.jpg`, 없으면 `/brief-covers/<categoryKey>.svg`. 클라이언트 `brief-card.ts` 는 `coverUrl` 만 쓴다.
- `frontend/public/brief-covers/`: 카테고리 10개 SVG(카테고리명 타이포 + 카테고리별 단색, 브랜드 규칙상 이모지 · 무관 이미지 없음). 사이즈는 카드 썸네일 비율 16:9.
- 2호 발송 조건: 등록 문서에 `picks[0]` 이 있어야 한다. 등록 API 가 발행(`publish: true`) 요청에서 `picks` 가 비어 있으면 400 으로 막는다(초안 저장은 허용).

## 5. 발송 전 확인 (핸드오프 "완료 판정" 마지막 항목)

- 코드에 브리프 발송 경로가 없다. 1호가 어떻게 나갔는지 원장에 없다 → 발송 방법과 CTA 목적지는 **James 확인** 항목.
- 이번 범위에 넣는 것: `POST /admin/newsletter/issues/:id/send` (dry-run 기본, 수신자 수 재확인 후 실제 발송 — 기존 broadcast 모듈의 형태) 가 `renderMail(doc, { readUrl: <PUBLIC_URL>/brief/<slug>, unsubscribeUrl: <PUBLIC_URL>/api/v1/brief/unsubscribe/<token> })` 로 렌더하고, 발송 계층에 `headers: { 'List-Unsubscribe': '<url>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }` 를 넘긴다. 실제 발송 실행은 James 만(훅 `email-send-guard` 가 막는다).
- CTA 가 `/brief/<slug>` 로 가려면 로그아웃 수신자도 열 수 있어야 한다 → 6절.

## 6. 결정이 필요한 것 (James)

1. ~~`/brief/*` 로그아웃 열람~~ **불허 (James 2026-09-15)**. 이후 공유 기능에 "공개" 를 붙여 열도록 한다. 따라서 `ProtectedRoute` 유지, 메일 CTA 는 `/brief/<slug>` 로 가되 로그인(`returnTo`)을 거친다. 완료 판정의 로그아웃 스크린샷 = 로그인 리다이렉트 화면.
2. 08-25 행 `published_at = null` 실행(위 SQL) — prod 데이터 변경.
3. 정적 사본 2개 삭제.
4. 1호 발송 방법 · 수신자 수 · CTA 목적지(원장 부재).
5. 현재 호 목차를 패널의 현재 호 아래에 접어 두는 안(권장) 대 목차 제거.

# 제약
- 브리프 본문 렌더러 · 8단계 파이프라인 무변경. 사이드바 전역 동작(접기 · 너비) 무변경.
- 프론트 변경 = `/verify` PASS 없이 push 금지(훅). 현재 맥북 메모리 압력 2 라 로컬 빌드 · 테스트가 훅에 막힌다 — CI 로 검증하고, 브라우저 검증은 압력이 1 로 내려간 뒤 또는 프로덕션 배포 후 스크린샷.
- DDL 없음. prod 데이터 변경은 James 실행.

# 검증 기준
- [ ] 로그인: `/brief/c/ai-tech` 좌측 = 돌아가기 · "AI 엔지니어링" + 구독 상태 · 호 목록(최신순). 만다라 목록 · 새 만다라 · 템플릿 찾기 없음 (데스크톱 · 모바일 드로어 스크린샷)
- [ ] 로그인: `/brief/2026-09-02-ai-tech` 좌측 = 같은 패널, 현재 호 강조, 그 아래 목차
- [ ] 로그아웃: 6-1 결정에 따라 화면 또는 로그인 리다이렉트 스크린샷
- [ ] 카드 · 헤더 · 패널 · 문서 제목 · 메일 제목의 호수가 `issue_no` 하나에서 오고, "제1호" 는 09-02 행 하나만 보인다(08-25 행은 draft)
- [ ] 카드 요약에 `<` `>` 없음 (`/brief/subscribed` 응답으로 확인)
- [ ] 표지 없는 호는 카테고리 SVG, 있는 호는 hqdefault
- [ ] `/learning/:mandalaId/:videoId` 패널 무변화 스크린샷 1장
- [ ] 메일 dry-run 출력: CTA = `/brief/<slug>`, 본문 해지 링크 + `List-Unsubscribe` 헤더
- [ ] 테스트: `SidebarBriefPanel.test.tsx`(패널 내용 · 현재 호 강조), `brief-routes` 스모크에 `labelOf` 와 excerpt 태그 제거, `brief-email.test` 에 헤더 존재

# james
6절의 결정 5개. 그중 1(공개 열람)과 2(데이터 수정)가 구현 순서를 정한다.

# restated
브리프 목록 · 읽기 화면에 카테고리 · 구독 · 호 목록 패널을 달고(모바일 포함), 호수를 DB 정수 한 곳에서만 읽게 하고, 카드 요약의 HTML 태그를 서버에서 벗기고, 표지 없는 호는 카테고리 표지로 채운다. 발송 경로는 코드에 없어 이번에 dry-run 발송 라우트와 해지 헤더를 넣되 실행은 James 가 한다.

# 결과
2026-09-15 — 1차 PR(백엔드 + 정적 사본 제거). 프론트는 2차 PR(사이드바 패널 · 모바일 · 카드 · 표지 SVG), `/verify` 게이트 때문에 분리.
- `issue-label.ts` `issueLabelOf(issue_no, locale)` — 목록 두 라우트 · 문서 응답 · HTML 렌더가 전부 이것을 쓴다. `content_json.issueLabel` 은 더 이상 읽지 않는다(등록 시 번호 추출에만 쓰임).
- `plain-text.ts` `plainText()` — 목록의 `dek` 와 메일 deck 이 같은 함수. 엔티티 복원 포함.
- `cover.ts` `coverUrlOf()` — 응답에 `coverUrl` 추가(`coverVideoId` 는 유지). 폴백 `/brief-covers/<key>.svg` 는 2차 PR 의 정적 파일.
- `GET /brief/c/:categoryKey/issues` 신설 — 구독 여부와 무관하게 카테고리의 발행 호 + 읽음 + 구독 상태. 패널과 목록 페이지의 소스.
- admin: 발행 요청에 `picks[0].videoId` 없으면 400 · (category, issue_no, locale) 충돌은 409 에 번호 명시 · `POST /admin/newsletter/issues/:id/send` (dryRun 기본, `expectedRecipients` 로만 실발송, 원장 `brief:<slug>`, 수신자 = 구독 계정 − 해지, 수신자별 토큰 발급, `List-Unsubscribe` · `List-Unsubscribe-Post` 헤더, CTA = `/brief/<slug>`). 발송 계층 `send()` 에 headers 인자 추가.
- `frontend/public/brief/*.html` 2개 untrack → `~/insighta-private/docs/brief-static-2026-08-25/` 로 이동(디스크 보존).
- 테스트 `tests/unit/modules/newsletter-issue-surfaces.test.ts` 13건(라벨 · plainText · cover · 메일 링크/헤더). 로컬 실행은 메모리 가드에 막혀 CI 결과로 판정.
- 남은 것: James 의 08-25 행 unpublish SQL, 2차 PR(프론트), 실제 dry-run 호출은 배포 뒤.
