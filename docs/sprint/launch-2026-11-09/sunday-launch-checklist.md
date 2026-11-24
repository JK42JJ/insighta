# 일요일(11-08) 출시 체크리스트

- 실행 주체는 **James** 다(본 repo 머지 · prod 설정 · 메일 발송). CC 는 조회와 문서만 돕는다.
- 전제: 파이프라인 변경(PR-B~E)이 출시 뒤이므로 **main 머지는 즉시 prod 에 DB 마이그레이션과 Edge Function 배포를 일으킨다**(`deploy.yml` 의 `migrate`, `deploy-edge-functions`). 이미지는 봇이 만든 핀 PR 을 James 가 머지할 때 배포된다. 이 사실이 이 체크리스트의 순서를 정한다.
- 규칙: R02(메일은 James 의 "보내" 후에만), R04(SSH 는 `scripts/ops/ssh.sh` 로만), R06(로컬 → prod), R31(`merge-green.sh` 로만 머지), R32(노드 증설 금지, 승인 전), "Done = Prod Verified".
- 표기: ☐ 미완, 괄호는 근거 문서.
- **일정 변경(2026-11-04 결정)**: SCH-1(스키마, additive-only)은 일요일이 아니라 **금~토에 백업 · 복원 증명 후 먼저 머지하고 하루 관찰**한다(N 절). 그래서 일요일에는 새 DDL 이 없다. 하네스 §0.1 의 출시 체크리스트 대응은 O 절.

## A. 일요일 오전: 스프린트 결과 점검 (James, 약 30분)

- ☐ `progress.md` 확인: `sprint-verified` / `blocked` / `needs-james` 목록
- ☐ Must 과제(`tasks.md` §3)의 상태. **Must 가 하나라도 미완이면 출시 범위를 줄인다**(F 절)
- ☐ 컷 라인 아래 과제는 이번 출시에서 제외하고 월요일 이후로
- ☐ 코드스페이스 구간 ③ 이 끝나기 전에 모든 브랜치가 `insighta-sprint` 에 push 되어 있는지

## B. 사전 확인 (James, 약 30분)

- ☐ **백업 (BAK-1)**: SCH-1 머지 전(금~토)에 이미 실행했는지 확인(N 절). 일요일에는 가장 최근 백업의 시각 · 크기만 확인한다(`aws s3 ls s3://insighta-backups/db/...`). 일요일 머지에 데이터 변경이 없으면 재백업은 선택
- ☐ **복원 증명 (BAK-2)**: 금~토에 SCH-1 머지 전 증명한 결과(`[drill]` 불일치 0)가 기록돼 있는지 확인
- ☐ **플랜 · 용량 (BAK-4)**: Supabase 콘솔에서 플랜, DB 크기, Backups 탭 기록. `auth.users` 는 `pg_dump --schema=public` 백업에 없으므로 Supabase 쪽 백업 유무를 적어 둔다
- ☐ prod 에 `recommendation_feedback` 이 실제로 있는지 확인(`\d recommendation_feedback`). 없으면 SCH-1 에 `CREATE TABLE IF NOT EXISTS` 가 있는지 확인
- ☐ 롤백 좌표 기록: 현재 prod `apiTag`/`frontendTag`(`charts/insighta/environments/prod.yaml`) 와 직전 정상 sha (R20)
- ☐ **PR-B 조건 확인 (James 결정)**: 출시할 PR 전부에서 `terraform/**` 변경이 없는지 확인한다. 각 PR 에 대해 `gh pr diff <번호> --name-only` 결과에 `terraform/` 로 시작하는 줄이 **없으면** PR-B(`Production` 환경 required reviewer, "Prevent self-review" 는 끔)를 **출시 전에 적용**한다. 하나라도 있으면 출시 후. 적용 효과는 terraform apply 와 promote 스텁 승인 대기뿐이며 `deploy.yml` 의 prod 잡은 여전히 승인 없이 돈다(README §7)

## C. DDL 검토와 로컬 검증 (James + CC)

R06 순서: 로컬 → prod. 출시 DDL 은 한 PR(SCH-1)이며 **금~토에 이미 머지 · 관찰한다(N 절)**. 이 절의 항목은 N 절에서 수행하고, 일요일에는 결과만 확인한다.

- ☐ 로컬에서 적용: `psql "$LOCAL_DATABASE_URL" -f prisma/migrations/recommendation-provenance/001_*.sql` (2회), `prisma/migrations/feature-flags/001_*.sql` (2회)
- ☐ `\d user_video_states`, `\d user_feature_flags` 로 컬럼 직접 확인 (**`prisma db push` silent fail 점검**)
- ☐ **James 가 컬럼 단위로 확인 (Q19)**: 새 컬럼은 `origin`, `origin_rec_id`, `origin_weight_version`, `origin_at` (모두 nullable, 기본값 없음). 새 테이블은 `user_feature_flags`. 삭제 · 이름 변경 · 타입 변경 · NOT NULL 추가가 **없음**을 diff 에서 확인
- ☐ SQL 이 `check-sql-allowlist.sh` 를 통과(PR CI 에서 확인)

## D. 본 repo 로 가져오기 (James)

- ☐ 스프린트 repo 를 원격으로 추가하고 필요한 브랜치만 가져온다: `git remote add sprint git@github.com:JK42JJ/insighta-sprint.git && git fetch sprint <branch>`
- ☐ 브랜치를 본 repo 로 push 하고 PR 을 연다 (한 PR = 한 변경). **PR 본문 네 칸을 확인**한다: Work order / Changed / Verified / Not verified(prod 미확인 명시) / Spec
- ☐ PR 마다 전체 CI 가 돌아 초록인지 확인 (이 시점이 첫 전체 CI 다)
- ☐ 이 머신 대신 메모리가 여유 있을 때 진행(메모리 압력 level 1 에서). git 작업은 가볍다

## E. 머지 순서 (James, 한 PR 씩 `bash scripts/ops/merge-green.sh <PR>`)

머지마다 `deploy.yml` 이 돈다. **다음 머지는 앞 머지의 `migrate` 가 끝나고 확인한 뒤에 한다.**

| 순서 | PR | 이유 |
|---|---|---|
| 1 | (SCH-1 은 이미 머지됨 — N 절) | 일요일에는 새 DDL 이 없다. 하루 관찰 결과만 확인 |
| 2 | (SCH-1 머지 직후 이미 수행) PostgREST 스키마 재적재 | 확인만 |
| 3 | FLG-2, FLG-3 (플래그 모듈 · 라우트) | 전역 env 스위치 기본값 = 꺼짐 |
| 4 | PRV-2, FB-1 (출처 기록 · 피드백 라우트) | 사용자에게 보이지 않는 변경 |
| 5 | ERR-1, ERR-2 (5xx 저장 · 클라이언트 에러 수집) | 출시 직전에 관측 경로를 먼저 가동 |
| 6 | FE: FB-2, FLG-4, ERR-3 | FE 는 R08 대상. 컨테이너 검증 결과와 PR 증거 확인 |
| 7 | ERR-4 (Keel 검사 + 주기) | 워크플로 변경. 빨간 실행은 James 에게 메일 |
| 8 | INV-1 (코드 게이트, 채택한 경우) | **가장 위험 — 마지막**. 채택하지 않으면 건너뜀 |

각 머지 뒤 확인: `gh run list --workflow deploy.yml --limit 1` 의 headSha 가 머지 커밋과 일치하는지 대조 후 `watch`. `migrate` 단계 로그에서 오류 · 경고 없음.

## F. 범위 축소 규칙

| 상황 | 조치 |
|---|---|
| SCH-1 이 로컬 검증에서 실패 | 출시 보류. 플래그 · 출처 보존 모두 밀린다. 에러 수집(ERR-1/2)과 초대 설정만으로 출시 가능 여부 James 판단 |
| FE 변경이 `/verify` 증거 없음 | 해당 FE PR 은 머지하지 않는다(R08) |
| 어떤 PR 의 CI 가 빨강 | 머지하지 않는다(R31) |
| Must 과제 미완 | 해당 기능 없이 출시하거나 출시를 늦춘다. 늦춤은 James 결정 |

## G. 이미지 배포 (James)

- ☐ 봇이 연 핀 PR(`images/<sha12>`, `prod.yaml` 태그 변경)을 확인하고 머지 (이 머지가 이미지 배포)
- ☐ Argo CD `insighta-prod` 동기화 확인 (`scripts/ops/argocd-ui.sh` 또는 `scripts/ops/ssh.sh k3s` 경유 읽기 조회)
- ☐ 노드 가용 메모리 확인 (11-04 측정 약 240~340MB). 출시 후 트래픽으로 부족해지면 **증설하지 않는다**(R32 승인 전). 불필요한 파드 축소 같은 조치는 James 가 정한다
- ☐ 롤백 후보 sha 보관: `rollback.yml` 의 `previous` 또는 직전 정상 sha

## H. 출시 구성 (James)

- ☐ 가입 모드 설정: 관리자 화면 `AdminBetaCampaign` 에서 `beta_signup_mode=invite_only` (기본값은 `open`이므로 **반드시 확인**). 출시는 INV-0(설정만)으로 시작하므로 Supabase 대시보드의 **신규 가입 비활성화** 상태도 확인한다(금요일 시험 5b 의 결과가 근거)
- ☐ 초대 대상자 승인: 신청자 `invited` 처리. **초대 이메일 발송은 James 가 직접 실행**(R02). CC 는 발송하지 않는다
- ☐ 초대 사용자의 플래그 활성화 (FLG-5 가 없으면 관리자 SQL/루트로 `user_feature_flags` 행 추가 — James/로컬 세션)
- ☐ **초대 사용자에게 `pro` 30일 부여 (INV-4, 결정됨)**: 부여 후 `user_subscriptions.tier` 와 `tier_expires_at`(=부여일+30일)이 기록됐는지 읽기 전용 SELECT 로 확인. 만료 예정일을 James 가 캘린더에 등록(자동 강등은 하지 않음 — INV-4a 결정 전 기본값)
- ☐ **사용자 안내문과 피드백 경로 (OPS-2)**: 안내문에 피드백 받을 곳을 적는다. 발송은 James 가 "보내" 로 직접(R02)
- ☐ **개인정보 안내 (OPS-3)**: `PrivacyPage.tsx` 가 새로 수집하는 이벤트(추천 노출 · 클릭 · 저장 · 해제, 클라이언트 오류, 사용 시 PostHog)를 포함하는지 대조표로 확인하고, 부족하면 James 가 문구를 확정한다

## I. prod 검증 — "Done = Prod Verified"

실제 로그인 앱(실데이터 · 실뷰포트)에서 한다. 강제 렌더나 목 데이터로 판정하지 않는다.

| # | 확인 | 방법 | 기대 |
|---|---|---|---|
| 1 | 초대 사용자 가입 · 첫 사용 | 초대 대상 계정으로 로그인 → 마법사 → 만다라 생성 → 카드 수집 | 끝까지 동작, 오류 없음 |
| 2 | 미초대 사용자 차단 | 초대되지 않은 이메일로 가입 시도 (Google · 이메일 각각) | 차단 또는 안내. 설정만 쓴 경우 Supabase 신규 가입 비활성화 효과 확인 |
| 3 | 플래그 | `GET /api/v1/feature-flags/me` (로그인 토큰) | 초대 사용자는 켜짐, 미부여는 꺼짐 |
| 4 | 출처 보존 | 추천 카드를 승격한 뒤 읽기 전용 SELECT: 해당 행의 `origin`, `origin_rec_id` 가 채워지고 `auto_added=false` | 채워짐 |
| 5 | 피드백 | 추천 카드 노출 · 클릭 후 읽기 전용 SELECT: `recommendation_feedback` 에 행 | 행 존재, 중복 제거 |
| 6 | 에러 수집 | 테스트 계정에서 의도적 FE 오류 1회, 의도적 5xx 1회(가능하면) | `error_events` 에 `frontend` / `api` 행. 쿼리스트링 · 이메일 없음 |
| 7 | 알림 경로 | Keel `error-rate` 실행(`gh workflow run keel.yml`) | 정상/이상 표시가 기대대로, 알림이 James 에게 도착 |
| 8 | 롤백 가능성 | `rollback.yml` 의 `previous` 로 dry 확인(실행 전 sha 가 ECR 에 있는지) | sha 존재 |

DB 조회는 R04 를 따른다. prod DB 에 데이터를 넣거나 바꾸지 않는다(읽기 전용 SELECT 만, James 승인).

## J. 월요일 아침 (출시일)

- ☐ 첫 2시간: GitHub 알림(Keel 적색), `error_events` 최근 행, 초대 사용자 첫 사용 수
- ☐ 롤백 기준(미리 정함): ① 초대 사용자가 첫 사용을 끝낼 수 없다 ② 5xx 가 연속 발생 ③ 데이터 손상 징후. 하나라도 해당하면 아래 K 의 롤백
- ☐ 노드 메모리 · 파드 재시작 횟수 확인 (증설은 R32 승인 후에만)

## K. 롤백 절차

| 대상 | 방법 | 비고 |
|---|---|---|
| 이미지 | `gh workflow run rollback.yml -f sha=<직전> -f reason=<이유>` → 생성된 PR 머지 → Argo 동기화 | James 만 실행(Q16). 승인 게이트 없음 |
| 새 기능 | `user_feature_flags` 행 비활성화 또는 env 스위치 끔 | 코드 롤백 없이 사용자에게서 숨김 |
| 가입 | `beta_signup_mode=closed` 로 전환 | |
| DDL | **되돌리지 않는다.** 추가만이므로 코드가 안 쓰면 무해 | 필요 시 후속 마이그레이션 |
| 데이터 | 백업 시점으로 복구는 부분 복원 레시피(`reference_db_daily_backup`)로, James 결정 | RPO 최대 24시간 |

## L. 스프린트 종료 정리 (S9)

- ☐ 구독 토큰 폐기 · 재발급 (`claude setup-token` 로 만든 `CLAUDE_CODE_OAUTH_TOKEN` 은 코드스페이스에 노출된 적이 있으므로 폐기)
- ☐ Codespaces 사용자 비밀값 삭제, 코드스페이스 삭제
- ☐ `insighta-sprint` repo 접근권한 점검, 필요 없으면 보관 또는 삭제
- ☐ 코드스페이스 사용량 확인(예산 상한 $20 대비 청구 확인)
- ☐ Ultra 플랜 처리: 웹 월 결제만 가능하므로 다음 결제일 전에 유지 · 변경을 정한다(James)
- ☐ 워크스페이스 한도: 콘솔에서 크레딧 금액을 확인한 뒤 James 가 설정, 자동 충전 끔. **트랙 B 에서 키를 쓰기 전에** 완료(이 체크리스트의 값은 문서에 쓰지 않는다)
- ☐ 회고: blocked · 실패 원인을 규칙 · 검사로 옮긴다. 이 결과가 상시 루프 하네스의 재료다

## N. SCH-1 선머지 절차 (금~토, James 결정)

| # | 단계 | 확인 |
|---|---|---|
| 1 | 본 repo 에 PR 을 열고 전체 CI 초록 | 12개 체크 통과 |
| 2 | **James 가 컬럼 단위로 확인 (Q19)**: `user_video_states` 에 `origin`, `origin_rec_id`, `origin_weight_version`, `origin_at`(모두 nullable), `user_subscriptions` 에 `tier_expires_at`(nullable), 새 테이블 `user_feature_flags`(RLS). 삭제 · 이름 변경 · 타입 변경 · NOT NULL 추가가 없음 | diff 에서 확인 |
| 3 | 로컬에서 `\d` 로 컬럼 확인 (R06, `prisma db push` silent fail 점검) | 컬럼 존재 |
| 4 | prod 에 `recommendation_feedback` 이 있는지 확인. 없으면 SCH-1 에 `CREATE TABLE IF NOT EXISTS` 포함 여부 | — |
| 5 | **BAK-1 백업 실행 → BAK-2 복원 증명** (`[drill]` 불일치 0). 증명 전에는 머지하지 않는다 | 로그 기록 |
| 6 | `bash scripts/ops/merge-green.sh <PR>` 로 머지 → `deploy.yml` 의 `migrate` 단계 오류 · 경고 없음 | headSha 대조 |
| 7 | **PostgREST 스키마 재적재** (Supabase 대시보드 → Settings → API → Reload schema) | 필수. 누락하면 새 컬럼이 조용히 누락될 수 있다 |
| 8 | prod 에서 `\d user_video_states`, `\d user_feature_flags`, `\d user_subscriptions` 로 컬럼 확인 (R04 경로 또는 Supabase SQL 편집기, 읽기 전용) | 컬럼 존재 |
| 9 | **하루 관찰**: 앱 동작, `error_events`, Keel 실행. 문제 신호가 없으면 일요일 머지로 진행 | 이상 없음 |
| 10 | 문제 시: 추가 전용이므로 코드가 쓰지 않으면 무해. 되돌리지 않고 후속 마이그레이션으로 처리 | — |

## O. 하네스 §0.1 출시 체크리스트 대응

| §0.1 항목 | 이 문서의 위치 |
|---|---|
| 머지할 PR 각각 CI 통과, 스키마는 추가만 | D, E, N-1~2, F |
| 출시 전 DB 백업 | N-5 (금~토), B |
| prod 스모크(가입 → 첫 덱 → 카드 시청) | I-1, OPS-1 |
| 초대 사용자 목록과 플래그 설정 | H (S7a 로 목록 · 인원 필요) |
| 롤백 경로 확인(rollback.yml, 플래그 끄기) | B 롤백 좌표, I-8, K |
| 피드백 받을 곳 준비(사용자 안내문) | H (OPS-2) |
| 개인정보 안내가 새로 수집하는 이벤트를 포함하는지 확인 | H (OPS-3) |

## M. 이 체크리스트가 확인하지 못한 것

- Supabase 의 신규 가입 비활성화가 Google 신규 가입을 막는지, `auth.users` 백업 유무, 대시보드 메뉴 이름(문서 기준 기억).
- `deploy.yml` 의 `scope` 판정이 DDL 변경에서 `migrate` 를 실제로 실행하는지(조사 보고 기준 `schema=='true'` 조건; 코드 전문은 읽지 않음).
- prod 에 `recommendation_feedback` 이 존재하는지.
- PR 별 CI 시간과 머지 순서의 총 소요(추정 2~3시간).
