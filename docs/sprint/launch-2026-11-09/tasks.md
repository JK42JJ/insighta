# 출시 스프린트 과제 목록 (출시 P0 / P1 / P2)

- 근거: 조사 4건(가입 · 기능 플래그, 추천 출처 · 피드백, 에러 모니터링 · 백업, 컨테이너 실행 조건). 경로는 `origin/main` 기준.
- **verify 의 상태**: 아래 명령은 이 세션에서 실행하지 못했다(이 머신은 메모리 압력으로 Jest 를 돌릴 수 없고, 새 테스트 파일은 아직 없다). 그래서 "실제로 돌아가는" 상태는 **목요일 Codespaces 실행에서 먼저 확정**한다 (`thursday-verify-run.md`, 초안 `drafts/verify-commands.tsv`). BROKEN 은 금요일 전에 고치거나 과제에서 뺀다. 규칙: 기존 테스트를 가리키는 명령은 main 에서 PASS 해야 하고, 새 테스트를 가리키는 명령은 "No tests found" 로 **실패(적색)** 해야 한다. 둘 다 아닌 명령은 과제에서 뺀다.
- 이름 충돌: WO-11-03 의 단계명 P0~P5 와 겹치므로 이 문서에서는 "출시 P0/P1/P2" 라 부른다. **P1 · P2 는 제안값**이다(James 는 P0 만 정의). S1 이니셔티브를 받으면 확정한다.

## 1. 공통 규칙 (모든 과제)

| 규칙 | 내용 |
|---|---|
| R-WO | 과제마다 작업 오더 `docs/work-orders/WO-2026-11-07-<id>.md`. `verify` 가 오더의 "검증 기준" |
| R-DB | 스키마는 추가만. Prisma + `prisma/migrations/<feature>/NNN_*.sql`(idempotent) 동봉, `check-sql-allowlist.sh` 통과, 로컬 DB 에서 `\d` 로 컬럼 확인(R06). prod 는 스프린트가 만지지 않는다 |
| R-TEST | 새 BE 테스트는 **`tests/smoke/`** 에 둔다. CI 의 Jest 는 `tests/(smoke|unit/keel|unit/modules/chatbot-rag|unit/modules/newsletter)` 만 돌리므로 `tests/unit/modules/*` 의 새 테스트는 CI 에서 실행되지 않는다. 기존 테스트 삭제 · skip · 약화 금지 |
| R-ROUTE | 새 API 는 FE `api-client` 메서드 + `frontend/src/__tests__/smoke/api-url-contract.test.ts` 항목 |
| R-FE | FE 변경은 R08(`/verify`) 대상. 컨테이너에서는 vitest + Playwright `no-auth` 프로젝트(API 는 `page.route` 로 대체)로 검증한다. 브라우저 검증을 못 하는 FE 과제는 넣지 않는다. D&D 는 건드리지 않는다(R10) |
| R-CFG | 업무 로직에서 `process.env` 직접 읽기 금지 → `src/config/**`. `hardcode-audit` baseline 은 감소만 |
| R-LLM | 새 LLM · 외부 API 호출 경로를 만들지 않는다(R01 · R27). verifier 가 `scan-diff.sh` 로 확인 |
| R-S8 | 설문 원문 · 개인 식별 정보를 에이전트 입력과 repo 에 두지 않는다. 이니셔티브는 익명 요약만 |
| R-DONE | 스프린트 안의 통과 = `sprint-verified`(verify + 전체 테스트 + verifier). "완료"는 prod 확인 뒤(R07). PR "Not verified" 에 "prod 미확인" 명시 |
| R-STOP | 같은 과제 2회 실패 → `blocked` + `QUESTIONS.md`. 되돌리기 어려운 결정(스키마 삭제, 의존성 추가, 외부 가입, 비용)은 `needs-james` |

## 2. 파일 소유와 직렬화 (충돌 방지)

공유 파일: `prisma/schema.prisma`, `src/api/server.ts`(라우트 등록), `frontend/src/shared/api/api-client.ts`, `api-url-contract.test.ts`, `src/api/routes/cards.ts`.
- 스키마 변경은 **한 PR(SCH-1)** 로 묶는다. 두 과제가 같은 파일을 다시 열지 않게 한다(R21).
- `server.ts` · `api-client.ts` · 계약 테스트를 건드리는 과제는 **한 레인에서 순서대로** 한다.
- `cards.ts` 는 PRV-2 · FB-3 이 건드린다 → 같은 레인.

| 레인 | 담당 | 순서 |
|---|---|---|
| L1 데이터 | worker 1 | SCH-1 → PRV-2 → FB-1 → FB-3 → FB-4 |
| L2 접근 | worker 2 | FLG-2 → FLG-3 → INV-4 → INV-3 → FLG-5 → INV-2 |
| L3 관측 + FE | L1 · L2 중 먼저 끝난 worker | ERR-1 → ERR-2 → ERR-3 → ERR-4, FB-2 · FLG-4 (FLG-3 · FB-1 뒤) |
| James/로컬 | 스프린트 밖 | BAK-1 ~ BAK-4 (자격 증명 필요) |

SCH-1 은 스프린트 시작 전에 끝나 있어야 한다(아래 2.5). 따라서 토요일 아침 시작 시 L1 · L2 는 병렬로 바로 출발한다.

## 2.5 일정 변경: SCH-1 선머지 (James 결정 2026-11-04)

SCH-1(스키마, additive-only)은 일요일이 아니라 **금~토에 백업 · 복원 증명 후 먼저 머지하고 하루 관찰**한다. 그래서 SCH-1 은 스프린트 worker 의 과제가 아니라 **금요일 시험 운전의 실제 과제**가 된다.

| 시점 | 작업 | 담당 |
|---|---|---|
| 금 오전 | 목요일 verify 결과 반영. prod 에서 `recommendation_feedback` 존재 확인(없으면 SCH-1 에 `CREATE TABLE IF NOT EXISTS` 추가) | James |
| 금 낮 | 시험 운전의 worker 1개가 SCH-1 구현 · 로컬 `\d` 검증 · PR(스프린트 repo) | 코드스페이스 |
| 금 오후 | James 가 컬럼 단위 확인(Q19) → 본 repo 로 가져와 PR → 전체 CI | James |
| 금 저녁~토 아침 | BAK-1 · BAK-2(백업 + 복원 증명) → SCH-1 머지 → Supabase 스키마 재적재 → `\d` 로 prod 확인 | James |
| 토 | 하루 관찰: 오류 · `error_events` · 앱 동작 | James |
| 토 오전 | 스프린트 시작. 워커는 SCH-1 머지 후의 main 을 받아 시작(`git pull`) | 코드스페이스 |

SCH-1 이 금요일에 끝나지 않으면: 토요일 스프린트는 SCH-1 에 의존하지 않는 과제(ERR-1, ERR-2, INV-3, FB-1 의 라우트 골격)부터 시작하고, FLG · PRV 는 SCH-1 머지 후로 미룬다. 일요일 머지는 하루 관찰이 없다는 위험이 있으므로 James 가 판단한다.

## 3. 컷 라인

시간이 모자라면 아래 순서로 버린다. **Must 는 월요일 출시의 전제**, 나머지는 밀린다.

| 등급 | 과제 |
|---|---|
| Must | SCH-1(금~토 선머지), PRV-2, FB-1, FLG-2, FLG-3, INV-0(설정), INV-4, ERR-1, ERR-2, BAK-1, BAK-2, OPS-1, OPS-3 |
| Should | FB-2, FLG-4, ERR-3, ERR-4, INV-3 |
| Could | FB-3, FB-4, FLG-5, INV-1(월요일 이후), INV-2, INV-5, BAK-3, BAK-4 |

## 4. 출시 P0 과제

표기: `verify` 의 "필요" 는 로컬 Postgres(PG) / 브라우저(BR) / 없음. 파일명이 `<new>` 인 테스트는 작성 시 확정한다.

### 4.1 스키마 (공통)

| ID | 제목 | done_when | verify | 필요 | files | depends | 스키마 |
|---|---|---|---|---|---|---|---|
| SCH-1 | 출시용 추가 DDL 한 PR (출처 보존 컬럼 + 사용자별 플래그 테이블 + 구독 만료 컬럼). **금~토에 백업 · 복원 증명 후 먼저 머지, 하루 관찰(§2.5)** | ① `user_video_states` 에 `origin varchar(20)`, `origin_rec_id uuid`, `origin_weight_version int`, `origin_at timestamptz` 가 nullable 로 존재(FK 없음). ② `user_feature_flags(user_id uuid, flag text, enabled bool, PRIMARY KEY(user_id, flag))` + RLS 켜짐. ③ `user_subscriptions` 에 `tier_expires_at timestamptz` nullable (INV-4 용; 현재 이 테이블에는 만료 컬럼이 없다) ④ SQL 은 idempotent(2회 적용 OK) ⑤ 끝에 `NOTIFY pgrst,'reload schema'` | `psql "$LOCAL_DATABASE_URL" -f prisma/migrations/recommendation-provenance/001_*.sql` 2회 → 오류 0 / `psql ... -c '\d user_video_states'` 에 4컬럼 / `psql ... -c '\d user_feature_flags'` / `psql ... -c '\d user_subscriptions'` / `npx prisma generate && npm run typecheck` / `bash scripts/ci/check-sql-allowlist.sh origin/main` | PG (일부 없음) | `prisma/schema.prisma`, `prisma/migrations/recommendation-provenance/`, `prisma/migrations/feature-flags/`, allowlist 스크립트 | 없음 | **y (추가만)** |

로컬 DB 에 기본 스키마를 만드는 방법(`prisma db push` 가 평문 Postgres 에서 `auth` 스키마와 함께 동작하는지)은 금요일 시험 3 에서 확인한다. 안 되면 대안: `prisma migrate diff --from-empty --to-schema-datamodel --script` 로 SQL 을 만들어 `psql` 로 적용(미검증).

### 4.2 초대 사용자 가입 · 첫 사용 (INV)

현황: 가입 제한은 로그인 화면(`LoginPage.tsx` → `POST /beta/check-invite`)에서만 동작한다. Google 로그인 · 매직 링크 · Supabase 직접 호출은 우회한다. `beta_signup_mode` 기본값은 `open`, 설정 조회 실패 시 열림(fail-open). 가입 후 `joined` 상태를 쓰는 곳은 찾지 못했다. 초대 → `pro` 자동 부여는 확인하지 못했다.

| ID | 제목 | done_when | verify | 필요 | files | depends | 스키마 |
|---|---|---|---|---|---|---|---|
| INV-0 | **설정만으로 초대 전용 시작** (James 결정 2026-11-04). 신규 가입 비활성화 + `beta_signup_mode=invite_only` | 금요일 시험 순서 통과: ① 초대 사용자 계정 먼저 생성 ② 신규 가입 비활성화 ③ 처음 보는 Google 계정 가입 **차단** 확인 ④ 초대 사용자의 Google · 매직 링크 로그인 **성공** 확인 | 수동(James): Supabase 대시보드 + 브라우저. 컨테이너 밖. 시험 환경 질문 INV-1a (README §11) | BR + 대시보드 | Supabase 대시보드, 관리자 화면 `AdminBetaCampaign` | 없음 | n |
| INV-1 | **서버 측 가입 게이트 (코드) — 월요일 이후로 이동** | 초대 상태(`invited`/`joined`)가 아닌 이메일의 인증된 API 호출이 403. Google · 매직 링크 가입도 동일. 설정 조회 실패 시 닫힘이 아니라 **기존 사용자는 통과, 신규는 거부** | `npx jest tests/smoke/<new>invite-gate.test.ts`(Prisma 모의: 초대됨/미초대/기존 사용자/설정 실패 4케이스) / 수동: PG + Supabase 인증 스택 + BR | 없음 (수동은 컨테이너 밖) | `src/api/plugins/auth.ts`, `src/modules/invites/gate.ts`(신규) | 없음 | n |
| INV-2 | `joined` 기록 + Google 경로의 안내 | 첫 로그인 후 `beta_applications.status='joined'`. 미초대 Google 사용자는 `/beta` 로 안내 | `npx jest tests/smoke/<new>beta-joined.test.ts` / `cd frontend && npx vitest run src/__tests__/<new>login-invite` | 없음 | `LoginPage.tsx`, `AuthContext.tsx`, `src/api/routes/beta.ts` | INV-1 | n |
| INV-3 | 출시일 초대 런북 + 모드 전환 확인 | `docs/ops/launch-invite-runbook.md`(모드 전환 · 신청자 승인 · 이메일 발송은 **James 가 직접**(R02)). `/beta/config`·`/beta/check-invite` 가 `open`/`invite_only`/`closed` 에서 기대값 | `npx jest tests/smoke/<new>beta-modes.test.ts` / `rg -n "xox|postgres(ql)?://|AKIA" docs/ops/launch-invite-runbook.md` → 0 | 없음 | `docs/ops/`, `tests/smoke/` | 없음 | n |
| INV-4 | 초대 → 30일 한정 `pro` | 초대 사용자에게 `tier='pro'` 와 `tier_expires_at = now()+30일` 을 기록하고 감사 기록. 만료 예정 목록을 읽기 전용 SELECT 로 뽑을 수 있다. 자동 강등은 하지 않는다(INV-4a 결정됨: **수동 강등**, 자동 집행은 Could) | `npx jest tests/smoke/<new>invite-tier.test.ts` | 없음 | `src/api/routes/admin/beta-applications.ts`, quota 관리자 | SCH-1 | n (컬럼은 SCH-1) |
| INV-5 | 초대 사용자 첫 사용 Playwright 명세 | 스테이징에서 `STG_TEST_EMAIL` 로 로그인 → 마법사 → 만다라 생성 → 카드 표시 | `cd frontend && npx playwright test -c playwright.stg.config.ts tests/stg/first-use.spec.ts` | 스테이징 + BR + STG 비밀값 | `frontend/tests/stg/first-use.spec.ts` | INV-2 | n |

**① INV-1 결정 필요**
- 코드: 위 과제. 위험이 높다 — 실제 사용자를 잠글 수 있다. 되돌림은 `beta_signup_mode=open` 환원이 아니라 코드 revert 가 필요하다.
- 설정만(코드 0): Supabase 대시보드에서 **신규 가입 비활성화** 후 James 가 초대 대상자를 관리자 초대로 추가. 이 방식이 Google 신규 가입까지 막는지는 이 세션에서 확인하지 못했다(미검증, 대시보드 작업은 James).
- 권고: 출시는 설정만으로 시작하고, INV-1 은 월요일 이후 안정화 과제로 둔다. 결정은 James.
- INV-5 는 컨테이너에서 실행 불가(스테이징 · 비밀값 필요). 작성만 하고, 실행은 머지 후 `e2e-staging` 워크플로.

### 4.3 기능 플래그 (FLG)

현황: 사용자별 플래그가 없다(전역 env 불린, `system_settings`, `user_skill_config` 등만). 최소 설계는 `user_feature_flags` 한 테이블 + `src/config/feature-flags.ts` + `GET /api/v1/feature-flags/me` + FE 훅.

| ID | 제목 | done_when | verify | 필요 | files | depends | 스키마 |
|---|---|---|---|---|---|---|---|
| FLG-2 | 플래그 레지스트리와 `isEnabledForUser` | 4케이스 통과: env 꺼짐 / env 켜짐 + 행 없음 / env 켜짐 + 행 있음 / admin. 업무 로직은 `process.env` 를 읽지 않는다 | `npx jest tests/smoke/<new>feature-flags.test.ts` / `npx tsx scripts/audit/hardcode-audit.ts` baseline 감소 또는 동일 | 없음 (Prisma 모의) | `src/config/feature-flags.ts`, `src/modules/feature-flags/`, 테스트 | SCH-1 | n |
| FLG-3 | `GET /api/v1/feature-flags/me` + URL 계약 | 인증 시 `{flags:{...}}`, 미인증 401. 계약 테스트에 URL 포함 | `npx jest tests/smoke/<new>feature-flags-route.test.ts` / `cd frontend && npx vitest run api-url-contract` | 없음 | `src/api/routes/feature-flags.ts`, `api-client.ts`, `server.ts` 등록, 계약 테스트 | FLG-2 | n |
| FLG-4 | FE `useFeatureFlag` 훅 + 게이트 예시 1곳 | 훅 단위 테스트 통과. 플래그 없는 사용자는 해당 컴포넌트가 보이지 않음 | `cd frontend && npx vitest run feature-flag` / Playwright `no-auth`(API `page.route` 대체)로 숨김 확인 | BR | `frontend/src/features/feature-flags/` | FLG-3 | n |
| FLG-5 | 관리자 쓰기 경로 + 초대 연동 | `PUT /admin/users/:id/flags/:flag` 가 감사 기록과 함께 동작, `authenticate + authenticateAdmin`(R28), 무인증 401 | `npx jest tests/smoke/<new>admin-flags.test.ts`(무인증 401 포함) | 없음 | `src/api/routes/admin/`, `beta-applications.ts` | FLG-2, INV-4 | n |

### 4.4 추천 출처 보존 + 피드백 배선 (PRV, FB)

현황: `auto_added=true` 는 `src/modules/mandala/place-auto-added-cards.ts:202-232` 한 곳에서만 만들어지고(chokepoint 스크립트가 강제), 추천 ID · 점수 · 사유는 SSE 알림에만 쓰이고 DB 에 남지 않는다. `src/api/routes/cards.ts` 의 L180-186 · 427 · 450 · 467 · 707 에서 `auto_added=false` 로 덮여 "원래 추천이었다"는 정보가 사라진다. `recommendation_feedback`(schema 2373-2387)은 쓰는 코드 · 읽는 코드가 0건이다. 이 테이블이 prod 에 실제로 존재하는지는 확인하지 못했다(추측: 스키마에만 있을 수 있음).

| ID | 제목 | done_when | verify | 필요 | files | depends | 스키마 |
|---|---|---|---|---|---|---|---|
| PRV-2 | 배치 시점에 출처 기록, 승격 시 보존 | `place-auto-added-cards.ts` 가 `origin`/`origin_rec_id`/`origin_weight_version`/`origin_at` 를 한 번 쓴다. `cards.ts` 의 어떤 SET 절도 `origin_*` 를 건드리지 않는다 | `npx jest tests/unit/modules/auto-add-recommendations.test.ts tests/smoke/cards-pin-routes.test.ts` / `bash scripts/ci/check-card-chokepoint.sh` / 새 테스트가 `createMany` 데이터와 승격 SQL 을 단언 | 없음 | `place-auto-added-cards.ts`, `auto-add-recommendations.ts`, `wizard-precompute.ts`, `cards.ts` | SCH-1 | n |
| FB-1 | 피드백 수집 라우트 | `POST /api/v1/recommendations/feedback` `{recommendationId, action}`: 401/400/200, 행위 화이트리스트(`impression`,`click`,`add`,`dismiss`), 소유권 확인, impression · click 중복 제거(최근 N분), `action_score` 매핑 | `npx jest tests/smoke/<new>rec-feedback.test.ts` | 없음 (Prisma 모의) | 새 라우트 파일, `server.ts` 등록, 테스트 | SCH-1 | n (표가 prod 에 있는지 확인 필요) |
| FB-2 | FE 클라이언트 + 호출 | `api-client` 메서드 + 계약 항목, 노출 · 클릭 · 해제 시 1회 발화, `trackRecommendationFeedback` 의 행위 이름을 실제 행위와 일치 | `cd frontend && npx vitest run src/__tests__/smoke && npx tsc --noEmit` | 없음 | `api-client.ts`, `posthog.ts`, `FeedCard.tsx`, `useRecommendations.ts` | FB-1 | n |
| FB-3 | 서버 측 `add` 이벤트 | 좋아요/핀 핸들러가 `origin_rec_id` 가 있을 때 `add` 행을 쓴다 | `npx jest tests/smoke/<new>cards-feedback.test.ts`(`$executeRaw` 경로 모의) | 없음 | `cards.ts` | SCH-1, FB-1 | n |
| FB-4 | 검증 SQL 과 런북 | 읽기 전용 SELECT: `origin` 분포 vs `auto_added`, 피드백 행위별 건수. prod 실행은 James/로컬 세션 | 문서 검토 + `rg -n "postgres(ql)?://" <doc>` → 0 | 없음 | `docs/ops/` (`docs/runbook/` 은 `.gitignore` 제외 경로라 커밋되지 않는다) | PRV-2, FB-1 | n |

### 4.5 에러 모니터링 (ERR)

현황: `error_events` 테이블은 있으나 API 5xx 는 기록되지 않는다(`src/api/server.ts:659` 핸들러는 로그만 남기고 500 반환). FE 에러는 `ErrorBoundary` 가 사용자에게 `error.message` 를 보여 줄 뿐 보고하지 않고, `window.onerror`·`unhandledrejection` 핸들러가 없다. Sentry 는 없다. Keel 알림은 Slack 웹훅이 없어 전달되지 않고 `keel.yml` 은 일 1회다(조사 결과 09:20 KST; 노트의 "30분"과 불일치, 추측: cron 변경됨). 출시 직후 James 가 분 단위로 아는 경로가 없다.

| ID | 제목 | done_when | verify | 필요 | files | depends | 스키마 |
|---|---|---|---|---|---|---|---|
| ERR-1 | API 5xx 를 `error_events` 에 저장 | 강제 500 이 `subsystem='api'`, `stage='http_5xx'` 행을 만든다. 쿼리스트링 · 이메일 제거, `request.routeOptions.url` 사용, 60초 중복 제거 | `npx jest tests/smoke/<new>error-handler-events.test.ts`(기록기 모의) | 없음 | `src/api/server.ts`, `src/modules/observability/error-events.ts` | 없음 | n |
| ERR-2 | FE 에러 수집 엔드포인트 | `POST /api/v1/client-errors`: 인증 필수, 본문 4KB 제한, 라우트별 rate limit(429), 이메일 · JWT · URL 쿼리 스크럽, `subsystem='frontend'`. 미인증 401 | `npx jest tests/smoke/<new>client-errors.test.ts` | 없음 | 새 라우트, `server.ts`, 계약 테스트 | 없음 | n |
| ERR-3 | FE 캡처 훅 + 안전한 폴백 화면 | `window.onerror` · `unhandledrejection` · `ErrorBoundary.onError` 가 메시지당 1회 전송. `ErrorFallback` 이 원본 메시지를 노출하지 않음 | `cd frontend && npx vitest run` / Playwright `no-auth` 에서 오류를 던지고 `page.route` 로 요청 1회 확인 | BR | `App.tsx`, `main.tsx`, `ErrorFallback.tsx`, `shared/lib/error-report.ts` | ERR-2 | n |
| ERR-4 | Keel `error-rate` 검사 + 주기 단축 | 최근 30분 `api`/`frontend` 행이 임계 이상이면 Keel 실행이 적색 → GitHub 이 James 에게 메일. 임계는 시험 운전에서 정함(추측) | `npx jest tests/unit/keel`(CI 가 도는 경로) / 실제 `gh workflow run keel.yml` 은 머지 후 | 없음 | `scripts/keel/checks.ts`, `.github/workflows/keel.yml` | ERR-1, ERR-2 | n |

ERR-4 의 알림은 James 에게만 가는 GitHub 기본 메일이다(R02 허용 목록 안). Slack 이 연결되면 같은 검사가 허용 채널로 전달된다.

### 4.6 출시 전 DB 백업 (BAK) — 스프린트 컨테이너 밖

컨테이너에는 AWS 자격 증명도 본 repo 쓰기 토큰도 없다. James 또는 이 머신/로컬 CC 세션이 한다. prod DB 는 호스팅 Supabase, 일 1회 `pg_dump`(03:00 UTC) → S3 30일 보관. 복원 훈련 기록은 2026-09-11(108개 테이블 불일치 0)이 마지막이다. `auth` 스키마는 이 백업에 포함되지 않는다.

| ID | 제목 | done_when | verify | 필요 | 담당 |
|---|---|---|---|---|---|
| BAK-1 | 출시 직전 백업 실행 | `backup.yml` 실행이 성공하고 S3 객체가 24시간 이내, 약 1GB 이상 | `gh workflow run backup.yml && gh run watch` / `aws s3 ls s3://insighta-backups/db/$(date -u +%Y/%m)/ --region us-west-2` | GitHub 인증, AWS 자격 증명(CC 없음) | James |
| BAK-2 | 그 객체로 복원 훈련 | `restore-drill.yml` 이 녹색, 로그의 `[drill]` 요약에 불일치 0, 테이블 108개 이상 | `gh workflow run restore-drill.yml -f key=<key>` / `gh run view <id> --log \| grep '^\[drill\]'` | GitHub 인증 | James (키만 알려 주면 CC 가능) |
| BAK-3 | 결과 기록 + 절차 문서 | `docs/security/restore-drills.md` 새 행 + `docs/ops/prelaunch-backup.md`. 비밀 값 없음 | `rg -n "postgres(ql)?://\|AKIA" docs/ops/prelaunch-backup.md` → 0 | 없음 | 스프린트 가능 (BAK-2 후) |
| BAK-4 | Supabase 플랜 · 용량 확인 | 플랜, DB 크기, Backups 탭 존재 여부를 기록(복원 훈련에서 약 1.5GB 로 보여 500MB 무료 한도와 맞지 않음 → 유료 플랜일 가능성, 추측) | Supabase 콘솔 (브라우저) | James |

`auth.users` 는 `pg_dump --schema=public` 에 없으므로 계정 복구는 Supabase 쪽 백업에 달려 있다 → BAK-4 에서 확인.

### 4.7 출시 운영 항목 (하네스 §0.1 체크리스트에서)

| ID | 제목 | done_when | verify | 담당 |
|---|---|---|---|---|
| OPS-1 | prod 스모크: 가입 → 첫 덱 → 카드 시청 | 초대 계정으로 prod 에서 끝까지 통과, 결과 기록 | 실제 로그인 앱(실뷰포트 · 실데이터)에서 수동 수행. 강제 렌더 불가 | James (CC 가 시나리오 작성) |
| OPS-2 | 사용자 안내문과 피드백 경로 | 초대 사용자에게 보낼 안내문(피드백 받을 곳 포함) 초안 → James 가 "보내" 지시 후 발송(R02) | 문서 검토. 발송은 James | James |
| OPS-3 | 개인정보 안내가 새 수집 이벤트를 포함하는가 | `frontend/src/pages/privacy/ui/PrivacyPage.tsx` 가 추천 노출 · 클릭 · 저장 · 해제와 클라이언트 오류 수집(+ PostHog 사용 시)을 다루는지 대조표 작성. 부족하면 문구 수정안을 제시 | `rg -n "추천|오류|이벤트|PostHog" frontend/src/pages/privacy/ui/PrivacyPage.tsx` 결과 대조 | CC 대조표, 문구 확정은 James |

## 5. P1 · P2 (제안 — S1 수령 후 확정)

| 등급 | ID | 제목 | 비고 |
|---|---|---|---|
| P1 | INV-5, INV-2, INV-4, FB-3, FB-4, FLG-5, BAK-3 | 4절에서 Could 로 둔 것 | 출시 안정화 |
| P1 | OBS-1 | 출시 사용자 퍼널 집계 SQL(가입 → 첫 만다라 → 카드 수집 → 첫 피드백) | 읽기 전용, FB-1 이후 |
| P2 | MEAS-* | PRD v1.2 의 측정 기반(오프라인 기준선 재구성, 라벨 도구, 거르기 오탐/미탐) | 이니셔티브와 겹치는지 확인 |
| P2 | INI-* | **S1 이니셔티브에서 도출** | 도착 후. 새 사용자 기능은 FLG 뒤 |

## 6. 위험

| 위험 | 대응 |
|---|---|
| INV-1 이 실제 사용자를 잠금 | 출시는 설정만으로 시작(권고). 코드 게이트는 월요일 이후, 기존 사용자 통과 조건을 테스트로 고정 |
| 출시용 DDL 머지 = prod 마이그레이션(승인 없음) | 일요일 체크리스트 순서: 백업 → 로컬 `\d` → James 가 컬럼 단위 확인 → DDL PR 만 먼저 머지 |
| `recommendation_feedback` 가 prod 에 없을 수 있음 | FB-1 착수 전 James/로컬 세션이 prod `\d recommendation_feedback` 확인. 없으면 SCH-1 에 `CREATE TABLE IF NOT EXISTS` 추가(추가만) |
| 새 BE 테스트가 CI 에서 실행되지 않음 | R-TEST: `tests/smoke/` |
| 병렬 레인의 공유 파일 충돌 | 2절 직렬화 |
| 12시간 구간 끝에 작업 유실 | 과제마다 commit · push, 구간 종료 1시간 전 새 과제 금지 |
