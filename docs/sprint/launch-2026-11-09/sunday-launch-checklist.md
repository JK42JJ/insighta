# 일요일(11-08) 출시 체크리스트

- 실행 주체는 **James** 다(본 repo 머지 · prod 설정 · 메일 발송). CC 는 조회와 문서만 돕는다.
- 전제: 파이프라인 변경(PR-B~E)이 출시 뒤이므로 **main 머지는 즉시 prod 에 DB 마이그레이션과 Edge Function 배포를 일으킨다**(`deploy.yml` 의 `migrate`, `deploy-edge-functions`). 이미지는 봇이 만든 핀 PR 을 James 가 머지할 때 배포된다. 이 사실이 이 체크리스트의 순서를 정한다.
- 규칙: R02(메일은 James 의 "보내" 후에만), R04(SSH 는 `scripts/ops/ssh.sh` 로만), R06(로컬 → prod), R31(`merge-green.sh` 로만 머지), R32(노드 증설 금지, 승인 전), "Done = Prod Verified".
- 표기: ☐ 미완, 괄호는 근거 문서.

## A. 일요일 오전: 스프린트 결과 점검 (James, 약 30분)

- ☐ `progress.md` 확인: `sprint-verified` / `blocked` / `needs-james` 목록
- ☐ Must 과제(`tasks.md` §3)의 상태. **Must 가 하나라도 미완이면 출시 범위를 줄인다**(F 절)
- ☐ 컷 라인 아래 과제는 이번 출시에서 제외하고 월요일 이후로
- ☐ 코드스페이스 구간 ③ 이 끝나기 전에 모든 브랜치가 `insighta-sprint` 에 push 되어 있는지

## B. 사전 확인 (James, 약 30분)

- ☐ **백업 (BAK-1)**: `gh workflow run backup.yml` → `gh run watch` → 성공 확인. S3 객체 시각 · 크기 확인(`aws s3 ls s3://insighta-backups/db/...`)
- ☐ **복원 증명 (BAK-2)**: `gh workflow run restore-drill.yml -f key=<방금 키>` → 로그 `[drill]` 에서 불일치 0
- ☐ **플랜 · 용량 (BAK-4)**: Supabase 콘솔에서 플랜, DB 크기, Backups 탭 기록. `auth.users` 는 `pg_dump --schema=public` 백업에 없으므로 Supabase 쪽 백업 유무를 적어 둔다
- ☐ prod 에 `recommendation_feedback` 이 실제로 있는지 확인(`\d recommendation_feedback`). 없으면 SCH-1 에 `CREATE TABLE IF NOT EXISTS` 가 있는지 확인
- ☐ 롤백 좌표 기록: 현재 prod `apiTag`/`frontendTag`(`charts/insighta/environments/prod.yaml`) 와 직전 정상 sha (R20)

## C. DDL 검토와 로컬 검증 (James + CC)

R06 순서: 로컬 → prod. 출시 DDL 은 한 PR(SCH-1)이다.

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
| 1 | SCH-1 (DDL만) | 이후 코드가 새 컬럼 · 테이블을 쓰므로 먼저. 머지 즉시 prod 에 적용된다 |
| 2 | (DDL 확인 후) PostgREST 스키마 재적재 | ALTER 직후 필수 (Supabase 대시보드 → Settings → API → Reload schema). 안 하면 새 컬럼이 조용히 누락될 수 있다 |
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

- ☐ 가입 모드 설정: 관리자 화면 `AdminBetaCampaign` 에서 `beta_signup_mode=invite_only` (기본값은 `open`이므로 **반드시 확인**). INV-1 설정안을 쓰는 경우 Supabase 대시보드의 신규 가입 비활성화도 확인
- ☐ 초대 대상자 승인: 신청자 `invited` 처리. **초대 이메일 발송은 James 가 직접 실행**(R02). CC 는 발송하지 않는다
- ☐ 초대 사용자의 플래그 활성화 (FLG-5 가 없으면 관리자 SQL/루트로 `user_feature_flags` 행 추가 — James/로컬 세션)
- ☐ 등급 결정(INV-4): 초대 사용자에게 `pro` 를 줄지

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
- ☐ 코드스페이스 사용량 확인(예산 상한 설정 시 청구 확인)
- ☐ 회고: blocked · 실패 원인을 규칙 · 검사로 옮긴다. 이 결과가 상시 루프 하네스의 재료다

## M. 이 체크리스트가 확인하지 못한 것

- Supabase 의 신규 가입 비활성화가 Google 신규 가입을 막는지, `auth.users` 백업 유무, 대시보드 메뉴 이름(문서 기준 기억).
- `deploy.yml` 의 `scope` 판정이 DDL 변경에서 `migrate` 를 실제로 실행하는지(조사 보고 기준 `schema=='true'` 조건; 코드 전문은 읽지 않음).
- prod 에 `recommendation_feedback` 이 존재하는지.
- PR 별 CI 시간과 머지 순서의 총 소요(추정 2~3시간).
