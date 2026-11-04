# 11/9 출시 스프린트 — 결정 기록과 개요

- 작성: 2026-11-04 (수). 목요일(11-05) 안에 낼 네 가지 산출물의 색인이다.
- 근거 범위: `origin/main` @ `19b83735` 이후 읽기, 읽기 전용 `gh` 결과, 공식 문서 조사(GitHub Codespaces · Environments, Claude Code). 라이브 DB · 클러스터 · prod 조회 없음. 표기: 경로가 붙은 것은 읽은 사실, "추측"은 추론, "미검증"은 확인하지 못한 것.
- 이 문서와 같은 디렉터리의 문서는 모두 제안이다. 코드 · 설정 · 토큰 · 저장소 변경은 James 승인 뒤에 한다.

## 1. 목표와 일정

| 항목 | 내용 |
|---|---|
| 마감 | 월 11-09, 일부 초대 사용자에게 사용 환경 제공 |
| 범위 | 하네스 §0.1 최신판을 받아 반영했다(2026-11-04). 원본 `weekend-sprint-harness.md` 는 James 의 로컬 파일이며 이 repo 에는 없다 |
| 새 기능 | 기능 플래그 뒤, 초대 사용자만 |
| 배포 파이프라인 변경(PR-B~E) | 출시 안정 후 |
| 출시분 반영 | 일 11-08 저녁 James 가 본 repo 로 가져와 직접 머지 |
| 일정 | 금 11-06 시험 운전 → 토 11-07 ~ 일 11-08 스프린트 → 일 저녁 머지 → 월 11-09 출시 |

## 2. 산출물

| 문서 | 내용 |
|---|---|
| `environment-codespaces.md` | Codespaces 스프린트 환경 구축안 |
| `tasks.md` | P0~P2 과제 목록 (done_when + verify) |
| `friday-dry-run.md` | 금요일 시험 운전 계획 |
| `sunday-launch-checklist.md` | 일요일 출시 체크리스트 (+ N: SCH-1 금~토 선머지, O: 하네스 §0.1 대응표) |
| `thursday-verify-run.md` | 목요일 Codespaces verify 실행 런북 |
| `drafts/` | 목요일 실행용 초안 4개 (`devcontainer.json`, `post-create.sh`, `thursday-verify.sh`, `verify-commands.tsv`). **미실행** |

## 3. 결정 기록 (James 2026-11-04)

| 항목 | 결정 | 이 문서에서의 반영 |
|---|---|---|
| S2 환경 | Codespaces. **이 머신에서는 스프린트 세션을 돌리지 않는다** | `environment-codespaces.md`. 단 문서상 12시간 수명 상한이 있어 설계가 바뀜 (§4) |
| S3 사용량 | Ultra. 인증 계정은 5시간 한도 없음, 주간 한도 Pro 의 10배 | James 가 확인한 공식 도움말 기준. **이 세션에서는 해당 도움말을 열어 보지 않았다.** R01 문구는 "플랜 포함 월 크레딧"으로 수정(#1766 `973a9886`) |
| S6 R01 | 구독 Claude Code 세션(무인 포함)은 R01 대상 아님. 원장에 한 줄 | #1766 에 반영. 세션이 만든 코드가 새 LLM API 경로를 추가하는 것은 계속 R01 대상 |
| S7 토큰 | T1: 별도 비공개 repo. 출시분은 James 가 본 repo 로 가져와 PR 머지 | 아래 §5, 환경 문서. deploy key 는 Codespaces 가 repo 단위 권한을 줄 수 있으면 불필요(미검증) |
| S8 설문 | 익명 요약만. 개인 식별 정보 금지. 원문은 에이전트에 주지 않는다 | 과제 규칙 R-S8 (tasks.md §1) |
| S9 권한 | 우회 플래그는 방화벽 · 비루트 · 자격 증명 없는 컨테이너 안에서만. 허용 도메인 목록. 스프린트 후 구독 토큰 폐기 · 재발급 | 환경 문서 §5, 일요일 체크리스트 K |
| R32 | 신설 유지. 메모리 메모 번호를 원장에 맞춘다 | 메모 3개 수정 완료 (§6) |
| PR-B | 월요일 이후. 출시 전 적용 여부는 James 가 결정 | 판단 근거 §7 |
| Q15 | terraform apply 는 별도 수동 dispatch (plan 확인 포함) | PRD v1.2 에 반영(§8) |
| Q16 | 롤백: 승인 게이트 없이 직전 이미지만, James 만 실행, concurrency 분리 | PRD v1.2 에 반영 |
| Q17 | promote 는 smoke + E2E 가 모두 성공한 **최신** sha 만 | PRD v1.2 에 반영. PR-A(#1769)의 gate 는 "해당 sha 의 성공"을 확인하며 "최신" 조건은 아직 없다 → PR-D 에서 추가 |
| Q18 | 환경 이름 불일치 | 문서상 대소문자 구분 없음 → 같은 환경 (§7) |
| Q19 | P2 전 스키마는 additive-only 만, James 확인 후 | 일요일 체크리스트 D: 출시 DDL 은 James 가 컬럼 단위로 확인 |
| 요건 접수 보강 3건 · `risk:human` 링크 | 승인 | PRD v1.2 §9 에 승인으로 표기 |

## 4. 이 조사가 바꾼 것 (먼저 읽을 것)

1. **Codespaces 는 48시간 연속 무인 실행을 지원하지 않는다.** 문서: 코드스페이스 최대 수명 12시간(유휴 · 활동 설정과 무관), 유휴 타임아웃 상한 240분. 중지하면 실행 중인 프로세스가 종료된다. 합법적인 유지 수단은 문서에서 찾지 못했다. 설계는 "12시간 구간 4개 + 상태는 git" 으로 바꿨다. 구간 경계가 James 의 확인 시간(토 · 일 아침 · 저녁)과 겹쳐서, 재시작을 그 시간에 한다. 이 12시간 상한은 요약 도구를 거친 결과이므로 **라이브 페이지로 한 번 더 확인**해야 한다.
2. **Codespaces 사용량은 무료 한도가 작다.** 개인 Free 월 120 코어시간, Pro 월 180 코어시간. 4코어로 48시간이면 192 코어시간이다. 한도를 넘으면 결제 수단이 없으면 **차단**, 있으면 과금(코어시간당 약 $0.09, 문서 기준)이다. 추정 비용과 선택지는 환경 문서 §3.
3. **PR-B 만으로는 `deploy.yml` 의 prod 잡에 승인 게이트가 생기지 않는다** (§7).
4. **출시용 DDL 머지는 곧 prod 마이그레이션이다.** 파이프라인 변경이 출시 뒤이므로, 일요일 DDL PR 머지 시 `migrate` 가 승인 없이 prod DB 에 적용된다. 그래서 백업 → 로컬 검증 → 머지 순서를 사람이 지킨다 (일요일 체크리스트).
5. **사용자 가입은 서버에서 막히지 않는다.** 가입 제한은 로그인 화면에서만 동작한다. Google 로그인 · 매직 링크 · Supabase 직접 호출은 우회한다. 설정만으로 막는 방법과 코드로 막는 방법 중 선택이 필요하다 (tasks.md INV-1).

## 5. 토큰 격리(T1) 구성

- 스프린트 repo(비공개, 예: `insighta-sprint`)에는 `.devcontainer/`, 제어 파일(`progress.md`, `decisions.tsv`, `features.json`, `STOP`)만 둔다.
- 작업용 clone 은 공개 repo `insighta` 를 토큰 없이 HTTPS 로 받고, 브랜치는 스프린트 repo 로만 푸시한다. 따라서 코드스페이스에는 본 repo 에 쓸 수 있는 자격 증명이 없다. 이 성질은 **금요일 시험 5에서 쓰기 거부를 확인해야** 성립한다 (코드스페이스 기본 토큰의 범위는 문서에서 확정하지 못했다).
- 출시분: James 가 스프린트 repo 에서 브랜치를 가져와 본 repo 에 푸시하고 PR 을 연다. 본 repo 에서는 전체 CI 가 돈다.

## 6. 메모리 메모 번호 정리 (완료)

| 파일 | 변경 |
|---|---|
| `MEMORY.md` | "promote.yml(R33)" → "(PRD v1.2 M0)", "추가 비용 불가(R32)" → "(승인 절차 = 원장 R32)" |
| `project_staging_environment_2026-10-29.md` | R33 · R32 표기를 원장 기준 설명으로 교체. 원장에는 "추가 비용 불가" 행과 R33 행이 없음을 명시 |
| `feedback_node_expansion_needs_slack_approval.md` | 원장 R32 승격, 승인 기록 정의(Production 환경 승인, Slack 인플레이스 포함) 추가 |

`feedback_state_omissions_as_consequences_first.md` 의 "비용이 걸린 결정(R32)" 은 원장 R32 의미와 맞아 그대로 둔다. 원장에 "추가 비용 불가" 행은 아직 없다(이번에 만들지 않았다).

## 7. PR-B 판단 근거 — `deploy.yml` 의 prod 잡이 `Production` 환경을 참조하는가

**참조하지 않는다.**

| 사실 | 근거 |
|---|---|
| `environment:` 키로 환경을 쓰는 워크플로 잡은 `terraform.yml:137` (`production`) 하나뿐이다 | `origin/main` 의 모든 워크플로 grep. `e2e.yml:6` 의 `environment` 는 입력 이름이고 환경 지정이 아니다 |
| `deploy.yml` 에는 `environment:` 가 하나도 없다. 잡: scope, mobile-gate, deploy-edge-functions(226), build-and-push(268), migrate(393), publish-tags(447), staging 잡들 | `deploy.yml` 의 잡 목록 |
| 보호 규칙은 그 환경을 참조하는 잡에만 적용된다 | 문서: "Protection rules apply only to jobs that reference the environment" |
| 환경 이름은 대소문자를 구분하지 않는다 → `production` 과 `Production` 은 같은 환경 | 문서: "Environment names are not case sensitive" |
| 현재 `Production` 환경에는 보호 규칙이 없다 | 이 세션 초반의 환경 API 조회 결과 |

**PR-B(Production 에 required reviewer 지정)만으로 즉시 생기는 게이트**
- `terraform.yml` apply 잡: 즉시 승인 대기가 된다 (main 푸시 + `terraform/**` 변경 시).
- `promote.yml`(#1769 머지 후)의 `approve` 잡: 즉시 승인 대기가 된다. 단 뒤의 세 잡은 `echo` 스텁이다.

**PR-B 만으로 생기지 않는 게이트**
- `migrate`(prod 스키마 동기화), `deploy-edge-functions`, `publish-tags`: 환경을 참조하지 않으므로 계속 승인 없이 실행된다. 이 셋을 막으려면 PR-D/E 에서 `promote` 로 옮기거나 잡에 `environment: Production` 을 달아야 한다.

**출시 전 적용 여부에 대한 판단 자료**
- 일요일 출시 PR 에 `terraform/**` 변경이 없으면 PR-B 의 영향은 없다 → 적용해도 출시에 방해가 없고, 얻는 것은 terraform 우발 apply 방지뿐이다.
- 적용하지 않아도 출시 안전성은 달라지지 않는다. 일요일의 DDL 보호는 설정이 아니라 **백업 → 한 PR 씩 머지 → 확인** 이라는 사람의 절차에 있다.
- "Prevent self-review" 는 끈 상태를 유지해야 James 가 dispatch 와 승인을 모두 할 수 있다.
- 결정은 James.

## 8. 미수신 · 미결

| 항목 | 상태 |
|---|---|
| 하네스 §0.1 원문 | 수신 (2026-11-04 최신판) |
| S1 이니셔티브, Q1 가치 지표 | 미수신 (James 가 따로) |
| P1 · P2 정의 | James 가 P0 만 정의. `tasks.md` 의 P1 · P2 는 제안값이며 S1 수령 후 확정. 또한 WO-11-03 의 단계명 P0~P5 와 이름이 겹친다 → 이 문서에서는 "출시 P0/P1/P2" 로 부른다 |
| Ultra 도움말 내용 | James 의 요약(Ultra = Max 20x 의 새 이름, 월 $200, 주간 한도 Pro 의 10배, 인증 계정 5시간 한도 없음, 월 API 크레딧 $200). 이 세션 미확인 |
| Codespaces 머신 RAM · 디스크, 기본 토큰 범위, DinD · compose 지원 | 문서 조사에서 확인 못 함 → 금요일 시험 운전에서 확인 |

## 9. 2026-11-04 추가 결정과 반영

| 항목 | 결정 | 반영 |
|---|---|---|
| S2' 코드스페이스 | (a) 4코어 + 결제 수단 + 예산 상한 $20. 12시간 구간 3개 유지. 에이전트 세션은 터미널에 출력이 계속 나가게(유휴 타임아웃 방지) | `environment-codespaces.md` §3 · §6 (하트비트). 유휴 방지가 실제로 먹는지는 금요일 소크로 확인 |
| verify | 목요일에 Codespaces 에서 먼저 실행, 안 되는 것은 금요일 전에 제외 | `thursday-verify-run.md` + `drafts/` (미실행 초안) |
| SCH-1 | 일요일이 아니라 **금~토에** 백업 · 복원 증명 후 먼저 머지, 하루 관찰 | `tasks.md` §2.5, 일요일 체크리스트 N |
| PR-B | 출시 PR 에 `terraform/**` 변경이 없으면 출시 전 적용, 아니면 출시 후 | 일요일 체크리스트 B. 현재 계획된 P0 과제 중 `terraform/**` 를 건드리는 것은 없다(ERR-4 는 `.github/workflows/keel.yml`) |
| INV-1 | 설정만으로 시작. 코드 게이트는 월요일 이후 | `tasks.md` INV-0 / INV-1, `friday-dry-run.md` §5b |
| INV-4 | 초대 사용자에게 pro 를 **30일 한정** 부여. 만료일을 데이터로 남긴다 | `user_subscriptions` 에 만료 컬럼이 **없다** → SCH-1 에 `tier_expires_at` 추가 (`tasks.md`) |
| 워크스페이스 한도 | 콘솔에서 크레딧 금액을 확인한 뒤 James 가 설정 | 일요일 체크리스트 L. 금액 값은 문서에 쓰지 않는다 |
| 명칭 | "출시 P0/P1/P2" 동의. P1 은 S1 수령 후 확정 | `tasks.md` |

**Ultra 관련 사실(James 요약, 미확인)을 반영한 항목**: ① "Current session" 막대가 없어야 5시간 한도가 없는 인증 계정이므로 목요일에 James 가 확인한다. ② 웹 월 결제만 가능하므로 스프린트 후 플랜 처리(유지 · 변경)를 다음 결제일 전에 정한다(체크리스트 L).

## 10. 질문 번호 정리

최신 하네스 문서는 S 번호를 다르게 쓴다(S6 = 크레딧 소진 실험 상한, S7 = 월요일 초대 사용자 수 · 목록과 플래그 도구). 이전에 제가 붙인 S6~S9(R01 해석, 토큰 격리, 설문 공개 범위, 권한 방식)는 이미 결정되었으므로 더 쓰지 않는다. 앞으로는 **최신 하네스 문서의 번호**를 쓴다.

## 11. 열린 질문

| # | 질문 | 막히는 것 | 자료 |
|---|---|---|---|
| S7a | 월요일 초대 사용자 수와 목록 | 일요일 H 절, INV-4 부여 대상 | James |
| S7b | 플래그 도구: 기존(DB) / PostHog | FLG 과제 | 현황: 사용자별 플래그는 없다. PostHog 는 `VITE_POSTHOG_KEY` 시크릿이 빌드에 연결돼 있으나 값이 설정돼 있는지는 모른다(코드는 키가 없으면 무동작). **권고: DB 테이블(`user_feature_flags`)** — 서버에서 판정해야 하는 과제(API 게이트)가 있고, PostHog 는 제3자 처리가 늘어 개인정보 안내(OPS-3)에 영향을 준다. FE 전용 실험에는 PostHog 를 나중에 병행 가능 |
| S6 / (c) | 크레딧 소진 실험을 이번 주말에 포함하는가 | 환경 설계 | 아래 |
| INV-4a | 30일 만료의 집행: 기록만 하고 수동 강등 / 읽기 경로에서 자동으로 `free` 로 취급 | INV-4 범위 | 기본값 제안: 기록 + 만료 목록 조회 쿼리 + 캘린더 알림(수동). 자동 집행은 별도 과제(Could) |
| INV-1a | 금요일 Google 시험을 어느 환경에서 하는가 | `friday-dry-run.md` §5b | 스테이징은 Google 로그인이 꺼져 있다(`frontend/tests/stg/login.spec.ts` 가 이메일 전용인 이유). 스테이징에서 하려면 Google 콜백 등록이 먼저(메모의 미결 항목). 인증 프로젝트는 스테이징과 prod 가 분리되어 있다 |

**(c) 크레딧 소진 실험에 대한 정리**
- 결정 목록에 (c) 선택이 없어 **이번 주말 범위에서 제외된 것으로 가정**했다. 포함하려면 하네스 §6.1 의 전제가 모두 필요하다: #1766 머지, 일일 $3 카운터의 주말 예외 승인, 워크스페이스 한도 · 자동 충전 끔, 서비스 키 공유 확인.
- 서비스 키 공유 확인(조사): `ANTHROPIC_API_KEY` 라는 이름은 서비스 · 배포 설정(`src`, `charts`, `.github`, `docker-compose.prod.yml`, `scripts`)에 없다. 서비스가 같은 Anthropic 조직 키를 쓰는지는 이 이름으로는 판단할 수 없다(서비스는 OpenRouter 를 쓰는 것으로 보이나 확인하지 않았다).
- 충돌: (c) 는 worker 가 headless 로 워크스페이스 키를 쓴다. 이 문서의 격리 설계는 컨테이너에 `ANTHROPIC_API_KEY` 가 없다는 것을 시작 조건(금요일 1-4)으로 둔다. (c) 를 하려면 이 조건을 "워크스페이스 키만 허용"으로 바꿔야 하고, 키가 노출되는 면이 구독 토큰에 하나 더 늘어난다. 이번 주말에 하지 않고 안정화 뒤로 미루는 것을 권고한다.
