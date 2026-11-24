# 상시 에이전트 루프 — 차이 분석 (gap-analysis)

- 작성: 2026-11-04 / PRD v1.0 §0 단계 2. 근거는 `current-state.md` 절 번호(§)로 인용한다.
- 분류: 이미 있음 / 그대로 채택 / 수정 채택 / 반대 / 판단 불가

## 0. 가장 먼저 읽을 것 — 목표와 정면 충돌하는 두 가지

1. **R01 (LLM API 금지).** 5개 역할 중 4개(helpdesk·strategist·executor·watcher)가 LLM API 호출이다. `agent-loop` 워크스페이스 키를 따로 만들어도 "서비스 전용" 규칙 위반이다(§9). 규칙을 개정할지는 James만 정한다. v1.1 은 **LLM 없이 가능한 트랙(A)과 LLM이 필요한 트랙(B)을 분리**하고, B는 결정이 날 때까지 보류한다.
2. **"에이전트는 stg까지만"(G4) 의 전제가 아직 성립하지 않는다.** main 머지는 즉시 prod DB 마이그레이션·Edge Function 배포를 실행하고(§2), 스테이징 결과는 아무것도 막지 않는다. `promote.yml` 이 들어가고 stg/prod DB 정책(WO-11-03)이 확정되기 전에는 **에이전트가 만든 PR을 머지하는 것 자체가 prod 변경**이다. v1.1 은 M-분류 이전에 이 선행조건을 둔다.

## 1. FR 별 분류

### FR-STATE

| FR | 분류 | 근거 / 변경 |
|---|---|---|
| STATE-1 디렉터리 | 수정 채택 | `tasks/`·`ops/`·`program.md` 를 새로 만들지 않고 기존 `docs/work-orders/`(+`QUESTIONS.md`)에 기계 판독 필드를 얹는다(§5). `ops/` 상태 파일은 `docs/ops/agent-loop/` 아래. `.claude/agents/` 는 원격에 추적되지 않으므로(§5) 에이전트 정의는 `docs/agent-loop/agents/` 로 두고 필요 시 복사. `insighta-eval` 별도 private repo 는 **그대로 채택**(공개 repo에 정답 라벨을 둘 수 없다, §4) |
| STATE-2 program.md | 수정 채택 | 규칙은 `rules-ledger.md` 가 SSOT. `program.md` 는 **지표 정의·목표값·예산만** 담고 규칙을 복제하지 않는다. Value metric 은 James가 채움(Q1) |
| STATE-3 과제 스키마 | 수정 채택 | JSON 파일 대신 WO front matter 확장(id, metric, allowed_paths, risk, attempts, max_attempts, blocked_by). 기존 `status` 값(draft/open/running/verified/closed)과 PRD 값을 매핑. CI에서 스키마 검증. 이유: 오더 19건·`work-orders.sh`·`done-gate`·R30 이 이미 이 형식에 묶여 있다 |
| STATE-4 decisions.tsv | 그대로 채택 | 신규. 기록 주체는 스크립트/CI. 에이전트 파일 쓰기 도구가 없으면 전용 CLI 경유 |
| STATE-5 results.tsv | 수정 채택 | insighta-eval 안에 두되 PR 코멘트·체크가 1차 기록. append-only 는 evaluator 워크플로 한 곳만 쓰도록 |

### FR-MEAS (최우선 유지)

| FR | 분류 | 근거 / 변경 |
|---|---|---|
| MEAS-1 이벤트 | **수정 채택** | 새 테이블이 아니라 **기존 `recommendation_feedback`(쓰기 0)를 배선**하고, `card_interactions`의 "첫 1회 유니크" 한계를 보완(§7). 필요한 추가: `recommendation_source`·`position`·`algorithm_version`·`weight_version` 컬럼, 추천→저장 시 **출처 보존**(`auto_added` 덮어쓰기 문제). 시청 시작/완료는 `watch_sessions` 와 `watch_position_seconds` 활용 가능 여부부터 확인. DB 규칙: raw SQL DDL + 로컬→prod + write path 전수 검토 + PostgREST reload |
| MEAS-2 기준선 비교 | **수정 채택** | 활성 사용자 1명 수준(§8)에서 사용자 단위 고정 배정은 무의미. **오프라인 기준선**(동일 후보 풀에서 최신순·무작위로 상위 10개를 재구성)을 주 방법으로, 사용자 배정 플래그는 100명 테스트용 선택 기능으로 격하. 만다라별 override(`search_algorithm_versions`)가 이미 있어 재사용 |
| MEAS-3 오프라인 평가 | 그대로 채택 | 고정 만다라 10개 코호트(`eval-harness/golden-cohort`)를 표본 틀로 재사용. **라벨은 James(사람)만** — LLM 라벨링은 R01 위반. 라벨 50개로는 상위 10개 지표의 신뢰구간이 넓으므로 목표를 "100개 이상, 구간 함께 보고"로 상향 제안 |
| MEAS-4 품질 지표 | 수정 채택 | "M1–M9 타이밍 핀"은 코드에 없다(§7). 정의부터 James 확인(Q10). 기존 `search_metrics_daily`·`pipeline_events`·`[TIMING]` 로그를 지표로 승격. 거르기 오탐/미탐은 오프라인 gold 108쌍(`docs/qa`)이 출발점이나 수치 미검증 → 재현부터 |

### FR-CI

| FR | 분류 | 근거 / 변경 |
|---|---|---|
| CI-1 필수 체크 `ci/guard` | 이미 있음 | 필수 체크 8개(§2). 새 이름을 만들지 않고 기존 잡에 "과제 스키마 검증"만 추가 |
| CI-2 테스트 조작 탐지 | 그대로 채택 | 신규 잡. 실제로 삭제 금지·skip 금지가 CLAUDE.md 에 있으나 CI 집행 없음(§5). 가장 값이 큰 신규 항목 |
| CI-3 금지 경로 탐지 | 수정 채택 | CODEOWNERS 가 먼저 필요. 단독 개발자 환경에서 코드 오너 리뷰를 필수로 걸면 **James 본인이 만든 PR도 승인 불가**(작성자는 자기 PR 승인 불가). 관리자 우회(`enforce_admins=false`)는 현재 유지되므로 실질 위험은 낮지만 "앱 우회 금지"와 구분해 명시 |
| CI-4 비밀값 분리 | 수정 채택 | repo가 public 이라 포크 PR 은 기본적으로 시크릿이 없다. 점검 항목으로 격하: 기존 워크플로에서 `pull_request_target`·시크릿 사용 여부를 grep 으로 감사 |

### FR-EVAL

| FR | 분류 | 근거 / 변경 |
|---|---|---|
| EVAL-1~7 | **수정 채택(대폭)** | "두 SHA 이미지를 PR 미리보기 네임스페이스에 배포"는 불가능하다: PR 미리보기 없음, 스테이징은 main 한정, 노드 여유 메모리 240~340MB(§2,§3), 증설은 Slack 승인 필요. **대안**: evaluator 를 GitHub Actions 러너(public repo 무료)에서 일회용 DB(compose)로 돌려 base/head 를 같은 러너에서 번갈아 측정하고, 정확도 지표는 **고정 후보 집합 + `cacheOnly`** 로 LLM 없이 계산. 지연 지표는 러너 잡음이 크므로 ABAB+MAD 기준을 유지하되 임계 상향. 정답 라벨은 private `insighta-eval` 의 워크플로에서만 사용 |
| EVAL-6 `metric: none` | 그대로 채택 | |
| 필수 체크화 | 수정 채택 | `evaluator/verdict` 는 James의 3건 판정 일치(PRD 완료 조건)를 통과한 뒤에야 필수로 승격 |

### FR-EXEC / FR-STRAT / FR-HELP

| FR | 분류 | 근거 / 변경 |
|---|---|---|
| EXEC-1~7 | **판단 불가 → 보류(트랙 B)** | R01 + 추가 비용 금지. 샌드박스 설정 키는 구현 직전에 공식 문서로 재확인(미검증). 대안 후보(James 선택): (a) R01 에 에이전트 루프 예외 + 월 상한 개정, (b) James 의 Claude Code 구독 세션/클라우드 루틴으로 실행(API 아님 — "CC 콘솔 작업" 허용 범위인지 James 해석 필요), (c) 루프를 LLM 없이 유지 |
| STRAT-1~7 | 판단 불가 → 보류 + 일부 이미 있음 | 과제 큐는 WO/`QUESTIONS.md`, 스크럼은 `digest.sh` 로 부분 존재. 아침 스크럼 **전달 채널이 없다**(Slack 부재, 메일은 R02). 우선 repo 파일/GitHub 이슈로 게시 |
| STRAT-5 지표 비면 추천 변경 금지 | 그대로 채택 | 가장 안전한 규칙. 트랙 A 에서도 스크립트로 집행 |
| HELP-1~3 | **반대** | Slack 이 존재하지 않고(§3), 상시 LLM 프로세스는 R01·비용 규칙에 걸린다. 기존 `QUESTIONS.md` 와 WO 흐름이 같은 역할. 재검토 조건: Slack 워크스페이스 + 승인 |

### FR-WATCH

| FR | 분류 | 근거 / 변경 |
|---|---|---|
| WATCH-1 비용·에러 감시 | 수정 채택 | Keel 이 비용(`llm-spend`, `aws-cost`)·헬스를 이미 감시. Sentry 는 스택에 없음 → `error_events`. **LLM 불필요**(스크립트). 전달 실패(Slack 부재)가 선행 블로커 |
| WATCH-2 머지 후 30분 + 롤백 호출 | 수정 채택 | `rollback.yml` 재사용. "watcher 에 롤백 권한 없음" 유지 = 워크플로 호출만 허용하는 최소 토큰. 단 prod 는 봇 PR 머지가 필요한 구조라 자동 롤백 = 롤백 PR 생성까지. 머지는 사람 |
| WATCH-3 누설 점검 | 수정 채택 | 스크립트화(diff 에서 heldout 경로 참조, 메모리 증가). LLM 판단 제외 |
| WATCH-4 테스트 후보 제안 | 판단 불가 | LLM 필요 → 트랙 B |

### FR-GH

| FR | 분류 | 근거 / 변경 |
|---|---|---|
| GH-1 repo 공개 범위 | 판단 불가 | 현재 PUBLIC. 공개 repo 의 IP/호스트명 노출은 "accepted pre-existing exposure"로 이미 결론난 정책이 있다(메모리). private 전환은 Actions 무료 분량·Argo/ECR 흐름에 영향. **권고: 앱 repo 는 현행 유지, `insighta-eval` 만 private** — James 확인 |
| GH-2 브랜치 보호 | 수정 채택 | 이미 있음(필수 체크 8, strict). 추가: PR 필수 리뷰는 단독 개발 환경과 충돌(CI-3 참고). `evaluator/verdict`·`ci/guard` 는 단계적으로 필수화 |
| GH-3 CODEOWNERS | 그대로 채택 | 신규. 초안 PR 까지만(PRD §0 항상 지킬 것 2) |
| GH-4/5 GitHub App 2개 | 판단 불가 | App 생성은 James. 트랙 A만으로는 evaluator 용 `checks:write` 하나면 충분(실행자 App 은 B에서) |
| GH-6 prod 승인 | 이미 있음 | prod 는 이미 "봇 PR + 사람 머지 + Argo". 또한 PRD 의 "required reviewers 불가" 전제는 **private repo 한정**이며 이 repo 는 public 이므로 Environment 필수 검토자를 쓸 수 있다(GitHub 문서 기반 지식, 이 세션에서 미검증). WO-11-03 도 이미 Environment 승인을 채택 |

### FR-INFRA

| FR | 분류 | 근거 / 변경 |
|---|---|---|
| INFRA-1 러너 EC2 | **반대(현 시점)** | 추가 비용 금지 + Slack 승인 전 실행 금지 + 노드 메모리 한계. 대안: GitHub Actions `schedule`/`workflow_dispatch`(public repo 무료) |
| INFRA-2 Secrets Manager | 반대 | 유료. 기존 GitHub Actions 시크릿/k8s Secret 사용. 시크릿은 James가 입력 |
| INFRA-3 IAM 최소권한 | 그대로 채택 | OIDC 역할 `insighta-github-actions` 를 분리해 읽기 전용 evaluator 역할을 따로 |
| INFRA-4 PR 미리보기 ns | 반대 | 메모리 한계(§3). 위 EVAL 대안 |
| INFRA-5 stg/prod 같은 차트 | 이미 있음 | `charts/insighta/environments/*.yaml` |
| INFRA-6 워크스페이스 2개 | 판단 불가 | R01 결정 종속 |
| INFRA-7 OTel→Sentry | 반대 | Sentry 가 스택에 없음. Keel + `error_events` |

## 2. 이 PRD 에 없으나 필요한 것 (추가 제안)

| # | 제안 | 이유 |
|---|---|---|
| X1 | **선행조건: `promote.yml` + stg/prod DB 정책 확정** | 위 §0-2. 이게 없으면 "에이전트 PR 머지 = prod 변경" |
| X2 | **훅·가드를 원격에 추적되는 곳으로 이동** | `.claude/settings.local.json` 훅은 원격 러너에 없다(§5). 규칙 집행은 CI(서버 측)로 해야 한다 |
| X3 | **추천 출처 보존 (`auto_added` 덮어쓰기)** | 이것 없이는 "추천이 효과 있나"를 사후에 잴 수 없다. MEAS-1 의 일부이지만 기존 데이터 모델 변경이라 별도 이슈 |
| X4 | **LLM 호출 경로를 막는 CI 장치 신설** (정정: 원장이 말한 `llm-call-ledger` 는 존재하지 않음) | 현재 집행은 `hardcode-audit` 의 OpenRouter 엔드포인트 규칙뿐. 에이전트 루프 키가 서비스 밖에서 쓰이는 것을 탐지하려면 Anthropic 엔드포인트 규칙과 허용 경로 목록이 필요. 허용 목록 변경은 James 전용 |
| X5 | **terraform 자동 apply·Production 환경 무검토** | 에이전트가 `terraform/**` 를 건드릴 수 있으면 머지=인프라 변경. 금지 경로(CI-3)에 포함 |
| X6 | **규모 현실 반영: 지표를 "방향성 신호"로 정의** | 활성 사용자 ~1명. 통계 검정 대신 효과 크기+구간, 100명 테스트 시점에 재설계 |
| X7 | **WO↔과제 용어 통일** | 용어가 둘이면 규칙 저장소처럼 이중화된다. "과제 = 작업 오더" |
| X8 | **Keel 알림 전달 해결(Slack 외 채널)** | watcher·스크럼 모두 전달 수단이 선행 |

## 3. 목표(§2)·사람 전용(§9)에 대한 의견

- **의도는 바꾸지 않았다.** G1~G4 유지. **G5(월 크레딧 안에 묶기)는 R01 결정에 종속**이라 "표시해서 제안": 트랙 B 가 승인되기 전에는 G5 를 "LLM 비용 0 유지"로 읽는 것이 현행 규칙과 정합한다.
- §9 에 하나 추가 제안: **`deploy.yml` 의 `migrate`·`deploy-edge-functions` 단계와 `terraform.yml`** 을 사람 전용 영역에 명시(PRD 는 "마이그레이션 contract 단계"만 적었으나 현재는 머지로 전 단계가 실행된다).
