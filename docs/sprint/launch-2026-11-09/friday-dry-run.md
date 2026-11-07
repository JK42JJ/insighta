# 금요일(11-06) 시험 운전 계획

- 목적: 토요일 아침 시작 전에 "돌아간다고 가정한 것"을 전부 실제로 돌려 본다. 통과하지 못한 것은 과제에서 빼거나 환경을 고친다.
- 원칙: 이 계획의 모든 항목은 **통과 기준과 실패 시 조치**가 있다. 기준을 못 채우면 시작하지 않는다(go/no-go).
- 코드 변경(`.devcontainer/`, 제어 스크립트, `worktree-setup.sh` 수정)은 James 승인 뒤에만 한다. 승인 전에는 이 계획을 읽는 것까지다.
- 담당: [J] James, [CC] 스프린트 세션 또는 시험용 세션. 시간은 추정이다.

## -1. 일정 조정 (James 결정 2026-11-04, 하네스 §0.1 반영)

- 하네스 §0.1: 금요일은 **2~3시간 시험 운전(worker 1개)** 이다. 이 문서의 1~4단계(환경 부팅 · 베이스라인 · DB 부트스트랩 · verify 전수)는 **목요일로 옮겨** `thursday-verify-run.md` 로 먼저 실행한다. 아래 1~4단계의 시각은 목요일 실행 때의 상대 순서로 읽는다.
- 금요일에 James 가 붙어 있어야 하는 것은 **5(격리) · 5b(초대 전용 설정 시험) · 6(실제 과제) · 7(장애)** 약 3시간이다.
- **8 소크는 James 없이** 금요일 저녁에 백그라운드로 돌린다.
- 6 의 샘플 과제는 **SCH-1** 이다(실제 출시분, 아래 6 참고). 금~토 선머지 일정은 `tasks.md` §2.5.

| 날 | 단계 | 담당 |
|---|---|---|
| 목 | 1 부팅 · 2 베이스라인 · 3 DB · 4 verify 전수 | James (쉘 명령만, 에이전트 세션 없음) |
| 금 오전 | 목 결과 확인, BROKEN 처리, 제외 과제 확정 | CC + James |
| 금 낮 ~3h | 5 격리 · 5b 초대 전용 설정 · 6 SCH-1 · 7 장애 | CC(코드스페이스) + James |
| 금 저녁 | 8 소크(무인 ≥4h, 하트비트 비교) | 코드스페이스 |
| 금 저녁 ~ 토 아침 | SCH-1 백업 · 복원 증명 → 머지 | James |

## 0. 목요일 밤 ~ 금요일 아침: James 준비 (약 1시간)

| # | 작업 | 담당 |
|---|---|---|
| 0-1 | 비공개 repo `insighta-sprint` 생성 (빈 repo + README) | J |
| 0-2 | Codespaces: 결제 수단 등록 + 예산 상한 $20 (결정됨). 이번 달 사용량 확인 | J |
| 0-3 | 유휴 타임아웃 240분, 자동 삭제 기간 설정 | J |
| 0-4 | `claude setup-token` 으로 구독 토큰 생성 → Codespaces **사용자 비밀값** `CLAUDE_CODE_OAUTH_TOKEN` 으로 등록, 접근 repo = `insighta-sprint` 만. (값은 CC 에 알리지 않는다) | J |
| 0-5 | Ultra 전환 확인(S3). **설정 > 사용량에 "Current session" 막대가 없는지 확인**(없으면 5시간 한도 없음). 있으면 병렬도를 줄이고 알려 줄 것 | J |
| 0-6 | GitHub 모바일: `insighta-sprint` 와 본 repo 알림 설정, 모바일에서 `STOP` 파일을 만들 수 있는지 1회 확인 | J |
| 0-7 | `insighta-sprint` 에 devcontainer · 제어 스크립트 PR 승인(아래 1단계에서 CC 가 만든 초안) | J |

## 1. 환경 부팅 (09:00 ~ 10:30)

| # | 작업 | 통과 기준 | 실패 시 |
|---|---|---|---|
| 1-1 | 4코어 코드스페이스를 `insighta-sprint` 에서 생성 | 생성 성공, 머신 RAM · 디스크 기록(`free -h`, `df -h`, `nproc`) | 8GB 이하면 병렬도 1로 계획 수정 |
| 1-2 | devcontainer 빌드(비루트, apt, PostgreSQL + pgvector, Node 20) | `node -v` 20.x, `id -u` ≠ 0, `psql --version` | compose 안으로 전환(지원 여부 확인) 또는 DB 검증 과제 제외 |
| 1-3 | `init-firewall.sh` 적용 (`NET_ADMIN`/`NET_RAW`) | 허용 도메인 `curl` 성공, 비허용 도메인(예: `example.com`) 실패 | 방화벽 불가 시 Claude Code `sandbox.network.strictAllowlist` 만으로 진행 + James 에게 위험 증가 보고, S9 재결정 |
| 1-4 | 환경변수 점검 | `env` 에 `ANTHROPIC_API_KEY`, `OPENROUTER*`, `DATABASE_URL`(prod), `AWS_*` 없음. `CLAUDE_CODE_OAUTH_TOKEN` 은 있음 | 하나라도 있으면 중단 |
| 1-5 | 공개 repo 를 토큰 없이 clone: `git clone https://github.com/JK42JJ/insighta.git` | 성공 | — |

## 2. 베이스라인 (10:30 ~ 12:00)

main 에서 각 명령을 실행해 결과를 `friday-results.md` 에 기록한다. 이 단계의 목적은 "컨테이너에서 CI 와 같은 명령이 통과하는가".

| # | 명령 | 통과 기준 |
|---|---|---|
| 2-1 | `npm ci` | 성공 (bcrypt · sharp 네이티브 빌드 포함) |
| 2-2 | `npm run lint` | 0 오류 |
| 2-3 | `npx prisma generate && npm run typecheck` | 성공. 더미 `DATABASE_URL`/`DIRECT_URL` 필요 여부 기록 |
| 2-4 | `ENCRYPTION_SECRET=<32자+ 더미> npx jest --testPathPattern='tests/(smoke\|unit/keel\|unit/modules/chatbot-rag\|unit/modules/newsletter)' --maxWorkers=3` | CI 와 같은 집합이 통과. **`CI` 변수는 설정하지 않는다.** 소요 시간 · 최대 메모리(`/usr/bin/time -v`) 기록 |
| 2-5 | `npx tsx scripts/audit/hardcode-audit.ts` | baseline 이하 (`ripgrep` 필요) |
| 2-6 | `bash scripts/ci/check-config-ssot.sh`, `check-card-chokepoint.sh`, `check-sql-allowlist.sh origin/main` | 통과 (SQL allowlist 는 `fetch-depth` 가 깊어야 함) |
| 2-7 | `cd frontend && npm install --no-package-lock --no-audit && npx tsc --noEmit && npx vitest run` | 통과 |
| 2-8 | `cd frontend && VITE_API_URL=/api VITE_SUPABASE_URL=https://placeholder.supabase.co VITE_SUPABASE_PUBLISHABLE_KEY=placeholder npm run build` | 성공 |
| 2-9 | `npx playwright install --with-deps chromium && npx playwright test tests/a11y.spec.ts --project=no-auth` (frontend 디렉터리) | 통과 |
| 2-10 | 동시 실행 메모리: 2-4 와 2-7 을 동시에 실행 | 최대 사용량이 RAM 의 85% 미만. 넘으면 `heavy.sh` 동시 1개로 |

실패한 명령은 원인을 기록하고, 그 명령에 의존하는 과제(tasks.md 의 verify)를 표시한다.

## 3. DB 부트스트랩 (13:00 ~ 14:00)

| # | 작업 | 통과 기준 | 실패 시 |
|---|---|---|---|
| 3-1 | 컨테이너 PostgreSQL 에 `vector` 확장 + `auth` 스키마 준비 | `\dx` 에 vector | pgvector 패키지 없으면 DDL 검증 과제를 최소 스키마 fixture 로 변경 |
| 3-2 | `npx prisma db push` (로컬 DB) | 오류 · 경고 없음, `\dt` 에 주요 테이블. **CLAUDE.md "silent fail" 점검**: `\d user_video_states` 로 컬럼 직접 확인 | 실패 시 `prisma migrate diff --from-empty --to-schema-datamodel --script` → `psql` 적용(미검증) |
| 3-3 | 샘플 DDL 적용: 임시 컬럼 하나를 `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` 2회 | 두 번째도 오류 0, `\d` 확인 | — |

## 4. verify 전수 실행 (14:00 ~ 16:00)

`tasks.md` 의 모든 verify 를 main 에서 실행한다.

| 분류 | 기대 결과 | 처리 |
|---|---|---|
| 기존 테스트를 가리키는 명령 | PASS | FAIL 이면 환경 문제 → 고침 |
| 새 테스트를 가리키는 명령 | "No tests found" 로 **실패(적색)** | 경로 · 러너가 올바름을 확인한 것 |
| 둘 다 아닌 명령(명령 오류, 필요한 도구 없음) | — | 과제에서 제외하거나 verify 를 고침 |
| BR/스테이징/자격 증명이 필요한 명령 | 컨테이너에서 실행 불가 | "머지 후 확인"으로 이동 |

결과는 `friday-results.md` 의 표(과제 ID, 명령, 기대, 실제, 판정)로 남긴다.

## 5. 격리 시험 (16:00 ~ 16:45) — 하나라도 실패하면 시작하지 않는다

| # | 시험 | 통과 기준 |
|---|---|---|
| 5-1 | 코드스페이스 토큰으로 본 repo 에 push: `git push https://github.com/JK42JJ/insighta.git HEAD:refs/heads/_isolation-test` | **거부**(403/404). 브랜치가 생기지 않음(`gh api repos/JK42JJ/insighta/branches/_isolation-test` → 404) |
| 5-2 | 같은 토큰으로 본 repo 의 PR 생성 · 머지 시도 (`gh pr create -R JK42JJ/insighta ...`, `gh pr merge`) | 거부 |
| 5-3 | `insighta-sprint` 에 push | 성공 |
| 5-4 | 비허용 도메인 접근 | 실패 |
| 5-5 | 환경변수 · 파일 점검: `~/.ssh`, `~/.aws`, `.env*` 없음 | 없음 |
| 5-6 | 정지 스위치: ① GitHub 웹에서 `STOP` 커밋 → 스크립트가 새 세션을 시작하지 않고 진행 중 세션을 정리, ② 코드스페이스 중지 | 각각 동작 |

5-1 이 통과하지 못하면 토큰 범위가 문서와 다른 것이므로 `customizations.codespaces.repositories` 설정을 조정한 뒤 재시험한다. 해결되지 않으면 스프린트를 취소한다.

## 5b. 초대 전용 설정 시험 (INV-0, James 결정 순서) — James 가 직접

CC 는 Supabase 대시보드에 접근할 수 없다. 순서는 James 가 정했다.

| # | 단계 | 통과 기준 |
|---|---|---|
| 5b-1 | **초대 사용자 계정을 먼저 생성**한다: 초대 대상 Google 계정 A(테스트용 포함), 그리고 **처음 보는 Google 계정 B** 를 준비(B 는 어떤 계정에도 한 번도 쓰이지 않은 것) | A 의 `auth.users` 행이 존재, B 는 없음 |
| 5b-2 | Supabase 대시보드에서 **신규 가입 비활성화** | 설정 저장 확인 |
| 5b-3 | **B 로 Google 가입 시도** | **차단**된다. `auth.users` 에 B 행이 생기지 않는다 |
| 5b-4 | **A 로 Google 로그인** | **성공**(기존 사용자로 로그인). 기존 계정에 Google 아이덴티티가 이메일로 연결되는지가 핵심 위험이다(미검증) |
| 5b-5 | **A 로 매직 링크 로그인** | 성공 |
| 5b-6 | 앱 레벨: `beta_signup_mode=invite_only` 상태에서 `/beta/check-invite` 가 미초대 이메일을 거부하는지 | 거부 |
| 5b-7 | 되돌림 확인: 신규 가입을 다시 활성화했을 때 B 가입이 되는지(환경이 prod 면 시험 직후 바로 원하는 상태로 설정) | 가역 |

- **환경(INV-1a, James 결정 2026-11-04)**: **prod 에서 금요일에 시험한다.** 근거: 활성 사용자 1명 수준(2026-09-11 측정), 출시 상태와 같음, 대시보드로 되돌릴 수 있음. 스테이징은 Google 로그인이 꺼져 있어 이 시험을 할 수 없다. 시험 시각은 아래에 **미리 적고**, 끝나면 상태를 기록한다.
- **5b-4 실패 시**: 이메일 · 매직 링크 중심 초대로 전환하는 절차를 미리 준비해 두었다 → `invite-fallback-email-magic-link.md`.
- **실패 처리**: 5b-3 에서 B 가 가입되면 설정만으로는 초대 전용이 성립하지 않는다 → 코드 게이트(INV-1)를 월요일 전으로 당길지, 출시 방식을 바꿀지 James 가 판단한다. 5b-4 가 실패하면(초대 사용자가 Google 로 로그인 못 함) 초대 절차를 이메일 · 매직 링크 중심으로 바꾸거나 계정 연결 방식을 확인한다.

### 5b 시험 창과 상태 기록 (prod, James 가 시각을 확정하고 기록)

시험 시각은 **시작 전에 이 표에 적는다.** 아래 시각은 제안값이다(금요일 낮 3시간 블록 안, KST).

| 항목 | 값 |
|---|---|
| 시험 창 (계획) | 금 11-06 14:00 ~ 15:00 — **James 확정: ________** |
| 시험 환경 | prod |
| 시작 전 상태 | `beta_signup_mode` = ____ / Supabase 신규 가입 = 활성 · 비활성 / 확인 시각 ____ |
| 시작 전 확인 | 기존 활성 사용자 1명의 로그인이 정상인지(James 본인 계정) ____ |
| 5b-2 변경 시각 | ____ (신규 가입 비활성화) |
| 5b-3 결과 | 차단됨 / 가입됨 — `auth.users` 에 B 행: 있음 · 없음 |
| 5b-4 결과 | 성공 / 실패 — 실패 형태: ______ |
| 5b-5 결과 | 성공 / 실패 |
| 5b-6 결과 | 거부됨 / 통과됨 |
| 시험 직후 확인 | 기존 사용자(James 본인 계정) 로그인 정상 ____ |
| 종료 후 상태 (의도) | 신규 가입 **비활성 유지**(출시 상태와 같으므로) / 활성으로 복원 — James 선택: ____ |
| 종료 시각 · 최종 상태 | ____ / `beta_signup_mode` = ____, Supabase 신규 가입 = ____ |
| 기록자 · 기록 시각 | ____ |

- 시험 창 동안 prod 에서 신규 가입이 막힌다. `/beta/apply`(신청서 제출)는 `auth.users` 를 만들지 않으므로 계속 동작할 것으로 보인다(코드 구조상 추측, 미검증).
- 시험 창이 끝나면 상태를 **즉시** 이 표에 적고, 이 표를 `friday-results.md` 에 옮긴다.

## 6. 샘플 과제 end-to-end (16:45 ~ 18:15)

**SCH-1**(출시용 추가 DDL)을 실제로 만든다. 출시분이므로 금~토 선머지 일정(`tasks.md` §2.5)에 이어진다. 낮은 위험 과제로 하네스를 먼저 검증하고 싶으면 `FLG-2` 를 보조로 하나 더 돌려도 된다.

| # | 단계 | 통과 기준 |
|---|---|---|
| 6-1 | coordinator 가 과제를 큐에서 꺼내 WO 와 브랜치를 만든다 | 오더에 검증 기준이 있음 |
| 6-2 | worker 세션: 구현 → 테스트 → 증거 → `insighta-sprint` 로 PR 형태 브랜치 push | 테스트 PASS, 증거 첨부 |
| 6-3 | **다른** verifier 세션(새 맥락)이 `scan-diff.sh` + verify 재실행 | 고의로 넣은 LLM 호출 줄(`api.anthropic.com`)을 잡는다(양성 대조), 깨끗한 diff 는 통과(음성 대조) |
| 6-4 | coordinator 가 통합 브랜치로 머지하고 `progress.md` 갱신 | 상태가 `sprint-verified` |
| 6-5 | 이 브랜치를 James 의 방식으로 본 repo 로 가져온다: `git fetch` → 본 repo 에 push → PR 생성 | 명령이 문서대로 동작. SCH-1 은 실제 출시분이므로 James 가 실제 PR 을 열고, 컬럼 단위 확인(Q19) 뒤 백업 · 복원 증명 → 머지 순서로 간다 |

## 7. 장애 시험 (18:15 ~ 19:00)

| # | 시험 | 통과 기준 |
|---|---|---|
| 7-1 | 세션 강제 종료 | `run-loop.sh` 가 재시작하고 `progress.md` 에서 이어감. 재시작 상한 · 백오프 동작 |
| 7-2 | 인증 만료 · 사용량 한도 오류 모의(잘못된 토큰으로 1회) | 재시작을 반복하지 않고 `progress.md` 에 기록 후 중단 |
| 7-3 | 같은 과제 2회 실패 모의 | `blocked` + `QUESTIONS.md` 항목 |

## 8. 소크 시험 (19:00 ~ 23:00, 무인 4시간)

토요일 야간 구간(②)을 대비해 **사람 없이** 4시간 돌려 본다.

| 측정 | 기준 |
|---|---|
| 코드스페이스가 유휴 타임아웃 없이 유지되는가(세션 출력이 활동으로 인정되는가) | 4시간 유지 |
| 구간 상한 12시간 | 라이브 문서/설정 화면으로 재확인 |
| 코어시간 소비 | 4시간 × 4코어 = 16 코어시간 소비로 계산이 맞는지, 이번 달 남은 한도 |
| 사용량 | 구독 사용량 소비 속도(체감), 한도 오류 발생 여부 |
| 메모리 | 최대 사용량 85% 미만 |

**하트비트 효과 비교**: 하트비트(60초마다 한 줄 출력)를 켠 상태 2시간과 끈 상태 2시간으로 나눠 유휴 중지 여부를 비교한다. 켠 상태에서만 유지되면 하트비트 요구가 증명된 것이다.

유휴로 중지되면 → 야간 구간은 포기하고 James 가 저녁 확인 시각에 짧은 구간을 추가로 돌리는 안으로 바꾼다(스프린트 시간 축소를 James 에게 보고).

## 9. 판정 (23:00)

**시작 조건 (모두 충족)**
1. 5-1, 5-2 거부 확인(본 repo 쓰기 불가)
2. 5-6 정지 스위치 동작
3. 6 샘플 과제 end-to-end 통과, 양성/음성 대조 포함
4. 4 단계에서 PASS 로 확정된 verify 가 Must 과제의 절반 이상
5. 1-4 환경변수 점검 통과
6. 8 소크에서 코드스페이스 유지 또는 대안 확정
7. Ultra 인증 확인("Current session" 막대 없음). 있으면 병렬도 1 로 조정하고 James 에게 알림
8. 5b 초대 전용 설정 시험 통과(5b-3, 5b-4, 5b-5). 실패 시 출시 방식을 James 가 결정
9. SCH-1 이 실제 PR 로 만들어졌고 James 의 컬럼 확인 단계에 도달함

하나라도 미충족이면 시작하지 않는다. 그 경우의 대안(James 결정): ① 토요일은 James 가 인터랙티브 세션으로 Must 과제만 진행(무인 없음) ② 출시 범위를 BAK + 설정 기반 초대(INV-1 설정안) + 에러 수집(ERR-1·2)으로 축소.

## 10. 산출물

`friday-results.md`(표), 수정이 필요한 PR 목록(`.devcontainer`, 제어 스크립트, `worktree-setup.sh`, 선택으로 `ci.yml` 트리거), go/no-go 판정문. 모두 James 승인 뒤 반영.
