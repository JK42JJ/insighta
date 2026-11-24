# PRD v1.1 — Insighta 상시 에이전트 개선 루프 (초안, James 승인 대기)

- 상태: **DRAFT — 승인 전에는 구현하지 않는다**
- 기반: PRD v1.0 (2026-11-04) + `current-state.md` + `gap-analysis.md`
- 목표(G1~G4)와 사람 전용 영역(§9)의 의도는 바꾸지 않았다. 바꾼 것은 방법이다. G5 는 아래 §2 에 표시했다.

## 1. v1.0 에서 달라진 큰 틀 (3가지)

1. **두 트랙으로 분리한다.** 트랙 A = LLM 호출이 없는 부분(측정·가드·evaluator·watcher·상태 파일). 트랙 B = LLM 이 필요한 부분(strategist·executor·helpdesk·테스트 후보 제안). A 는 현행 규칙 안에서 $0 로 바로 시작 가능. B 는 R01(LLM API 금지)과 비용 규칙 때문에 James 의 결정(Q8·Q9) 전까지 보류한다. *이유: v1.0 의 5개 역할 중 4개가 R01 위반.*
2. **새 시스템을 짓지 않고 기존 것에 얹는다.** 과제=작업 오더(WO), 규칙 SSOT=`rules-ledger.md`, ci/guard=기존 필수 체크+신규 잡, watcher=Keel, 롤백=`rollback.yml`, 배포=기존 GitOps. *이유: 이미 있고 James 의 운영 방식(R14·R30·R31)에 묶여 있다.*
3. **선행조건을 명시한다.** main 머지가 곧 prod DB 마이그레이션이므로, `promote.yml` 과 stg/prod DB 정책(WO-11-03)이 정리되기 전에는 **어떤 에이전트 PR 도 머지하지 않는다.** *이유: "stg 까지만" 이 아직 성립하지 않는다.*

## 2. 목표 (v1.0 §2 와 대응)

| | v1.0 | v1.1 |
|---|---|---|
| G1 추천 효과를 잴 수 있게 | 동일 | 동일. 단 활성 사용자가 ~1명이라 지표는 "효과 크기 + 구간" 의 방향성 신호로 정의(X6) |
| G2 제안→측정→유지/폐기 루프 | 사람 개입 없음 | 트랙 A 로 **측정·판정 부분**만 무인. 제안(LLM)은 트랙 B |
| G3 판정은 분리된 evaluator | 동일 | 동일. evaluator 는 LLM 없는 스크립트 |
| G4 에이전트는 stg 까지만 | 동일 | 동일하되 선행조건 X1 충족 후 |
| **G5 월 크레딧 안에** | API 비용 상한 | **⚠ 목표 변경 제안**: R01 이 개정되지 않는 한 "LLM 비용 0 유지"로 읽는다. 개정 시 상한은 James 가 정한다 |

## 3. 기능 요구사항 — 변경점 (v1.0 → v1.1, 한 줄 사유)

완료 조건은 모두 제안값이며 James 승인 시 확정한다.

### 3.1 상태 (FR-STATE)

| FR | v1.1 | 변경 사유 |
|---|---|---|
| STATE-1 | `docs/work-orders/`(과제), `docs/ops/agent-loop/`(decisions.tsv·daily·weekly·test-proposals), `docs/agent-loop/program.md`, private `insighta-eval`(heldout·results.tsv). `tasks/`·`ops/` 최상위 디렉터리 안 만듦 | 기존 WO 체계 재사용, 규칙 저장소 이중화 방지 |
| STATE-2 | program.md = 지표 정의·목표값·예산만. 규칙은 `rules-ledger.md` | 규칙 SSOT 단일화 |
| STATE-3 | WO front matter 확장(`id, metric, allowed_paths, risk, attempts, max_attempts, blocked_by`) + JSON Schema + CI 검증 | `work-orders.sh`·`done-gate` 호환 |
| STATE-4/5 | 컬럼 유지. 기록은 스크립트/CI만 | 에이전트 직접 쓰기 제거 |

### 3.2 측정 (FR-MEAS) — 트랙 A, 최우선

| FR | v1.1 | 변경 사유 |
|---|---|---|
| MEAS-1 | **기존 `recommendation_feedback` 배선** + `recommendation_source`·`position`·`algorithm_version`·`weight_version` 컬럼 추가 + 추천→저장 시 출처 보존. `card_interactions` 의 첫 1회 유니크 한계 보완. 시청 시작/완료는 `watch_sessions` 활용 가능성부터 확인. raw SQL DDL, 로컬→prod, write path 전수 검토, PostgREST reload | 테이블이 이미 있고 쓰는 코드만 없다. 새 테이블을 만들면 중복 |
| MEAS-2 | **오프라인 기준선**(동일 후보 풀에서 최신순·무작위 상위 10개 재구성)이 주. 사용자 단위 고정 배정은 100명 테스트용 선택 기능 | 활성 사용자 ~1명 → 사용자 단위 A/B 무의미 |
| MEAS-3 | 라벨은 James(사람)만. 표본 틀 = 기존 골든 코호트 10 만다라. 목표 라벨 수 100+, 구간 함께 보고 | 라벨 50개는 구간이 넓다. LLM 라벨은 R01 위반 |
| MEAS-4 | "M1–M9" 정의를 James 확인(Q10) 후 기존 `search_metrics_daily`·`pipeline_events`·`[TIMING]` 을 지표로 승격. 거르기 오탐/미탐은 오프라인 gold 108쌍(`docs/qa`)을 재현하는 것부터 | 핀이 코드에 없다 |
| 신규 MEAS-5 (X3) | `auto_added` 덮어쓰기로 사라지는 "원래 추천이었음" 보존 | 사후 효과 측정의 전제 |

### 3.3 CI Guard (FR-CI) — 트랙 A

| FR | v1.1 | 변경 사유 |
|---|---|---|
| CI-1 | 신규 체크 이름을 만들지 않고 기존 잡에 과제 스키마 검증 추가 | 필수 체크 8개 이미 있음 |
| CI-2 | 신규 잡: 테스트 삭제/`.skip`/`.only`/단언 수 감소/mock 증가/스냅샷 변화 탐지 → `needs-human` 라벨+실패 | CLAUDE.md 금지 사항이나 CI 집행 없음 |
| CI-3 | CODEOWNERS(초안 PR) + 금지 경로 탐지. 금지 경로에 `terraform/**`, `.github/**`, `deploy.yml`의 migrate 단계, `charts/**/prod.yaml`, 인증·결제·RLS 추가 | 머지가 곧 마이그레이션·apply (X5) |
| CI-4 | 감사 항목으로 격하: `pull_request_target`·시크릿 사용 grep | public repo 는 포크 PR 에 시크릿 없음 |
| 검증 | 일부러 위반을 넣은 테스트 PR 5개가 모두 잡힘 (유지) | |

### 3.4 evaluator (FR-EVAL) — 트랙 A

| FR | v1.1 | 변경 사유 |
|---|---|---|
| EVAL-1 | 입력은 base/head SHA 와 diff (유지) | |
| EVAL-2 | **GitHub Actions 러너에서 일회용 DB 로 측정**(PR 미리보기 네임스페이스·k8s 사용 안 함). 정확도 지표 = 고정 후보 집합 + `cacheOnly`(LLM 없음) | 미리보기 없음, 노드 여유 240~340MB, 증설은 Slack 승인 |
| EVAL-3 | ABAB 10회 + MAD 유지, 러너 잡음 고려해 임계는 실측 후 확정 | 공유 러너는 잡음이 크다 |
| EVAL-4/5 | 라벨은 private `insighta-eval` 워크플로에서만 접근. 판정 4종+`keep-no-metric`. `evaluator/verdict` 체크 | |
| EVAL-6/7 | 유지 / 불필요(미리보기 없음) | |
| 필수화 | James 가 만든 PR 3개의 판정이 일치한 뒤에만 필수 체크로 승격 | |

### 3.5 watcher (FR-WATCH) — 트랙 A

| FR | v1.1 | 변경 사유 |
|---|---|---|
| WATCH-1 | Keel 검사 추가(에이전트 루프 비용·실패 사이클). Sentry 대신 `error_events` | Sentry 가 스택에 없음 |
| WATCH-2 | 머지 후 30분 감시 → 기준 초과 시 **`rollback.yml` 호출로 롤백 PR 생성**까지. 머지는 사람 | prod 는 봇 PR 머지 구조 |
| WATCH-3 | 누설 점검을 스크립트로(heldout 경로 참조, 메모리 파일 증가) | LLM 불필요 |
| WATCH-4 | 트랙 B 로 이동 | LLM 필요 |
| 선행 | 알림 전달 채널 해결(X8). 현재 Slack 부재로 Keel 알림도 전달 안 됨 | |

### 3.6 GitHub (FR-GH) — 초안 PR 까지만, 적용은 James

| FR | v1.1 | 변경 사유 |
|---|---|---|
| GH-1 | 앱 repo 는 현행(public) 유지 권고, `insighta-eval` 만 private. **Q2 확인** | 공개 노출은 이미 정책 결론. private 전환 영향 큼 |
| GH-2 | 기존 보호 유지. `ci/guard`(CI-2)·`evaluator/verdict` 를 단계적으로 필수화. PR 필수 리뷰는 단독 개발자와 충돌하므로 `enforce_admins=false` 유지 여부를 Q13 으로 | 현재 상태 반영 |
| GH-3 | CODEOWNERS 초안 PR (경로는 CI-3 금지 경로와 동일) | |
| GH-4/5 | 트랙 A 는 evaluator App 하나(`checks:write`, `pull_requests:write`)면 충분. 실행자 App 은 트랙 B | 최소 권한 |
| GH-6 | 이미 있음(봇 PR+사람 머지+Argo). Environment 필수 검토자는 public repo 라 사용 가능(문서 기반, 미검증)이며 WO-11-03 이 채택 | v1.0 의 전제는 private repo 한정 |

### 3.7 인프라 (FR-INFRA)

| FR | v1.1 | 변경 사유 |
|---|---|---|
| INFRA-1~2,4 | 러너 EC2·Secrets Manager·PR 미리보기 ns **삭제**. GitHub Actions(schedule/dispatch) + 기존 시크릿 | 추가 비용 금지, 노드 한계 |
| INFRA-3 | 읽기 전용 evaluator 용 OIDC 역할 분리 | |
| INFRA-5 | 이미 있음 | |
| INFRA-6/7 | 트랙 B 로 이동 / 삭제 | R01 / Sentry 없음 |

### 3.8 트랙 B (보류): strategist · executor · helpdesk

- v1.0 FR-EXEC·FR-STRAT 의 설계는 유지하되 **Q8 결정 전에는 구현하지 않는다.** 샌드박스 설정 키(`failIfUnavailable`, `network.strictAllowlist` 등)는 구현 직전에 공식 문서로 재확인한다(미검증).
- FR-HELP 는 **반대**: Slack 이 없고 상시 LLM 프로세스는 규칙에 걸린다. 기존 `QUESTIONS.md` 가 같은 역할. 재검토 조건 = Slack + 승인.
- 실행 방식 후보(James 선택, Q8): (a) R01 개정 — 에이전트 루프 전용 예외와 월 상한 / (b) James 의 Claude Code 구독 세션·클라우드 루틴으로 실행(API 가 아니다 — "CC 콘솔 작업" 범위인지 James 해석 필요) / (c) 루프를 LLM 없이 유지.

## 4. 마일스톤 (코드베이스 기준 재작성)

| M | 내용 | 완료 조건 | 의존 |
|---|---|---|---|
| **M-0** | James 결정: Q8·Q9·Q1·Q2·Q10 | 답변 기록(`decisions.tsv` 첫 행) | — |
| **M0** | 상태 파일 골격: program.md 템플릿(빈칸), WO front matter 스키마+CI 검증, `docs/ops/agent-loop/` | 스키마 검증 CI 통과, 기존 WO 19건이 깨지지 않음 | M-0 |
| **M1** | 측정 기반 — 이벤트 배선(MEAS-1/5), 오프라인 기준선(MEAS-2), 라벨 도구와 `insighta-eval` 골격(MEAS-3), 지표 재현(MEAS-4) | 현재 추천 vs 기준선 점수 1회 산출(구간 포함), 같은 조건 2회 측정 차이 보고 | M0, Q1, Q10, **James 라벨링 시간** |
| **M2** | CI Guard(CI-2/3/4) + CODEOWNERS 초안 + evaluator v0 | 위반 테스트 PR 5개 모두 차단, James PR 3개 판정 일치 | M1 |
| **M3** | watcher: Keel 확장 + 알림 채널 해결 + 롤백 PR 연결 | 일부러 낸 stg 에러에서 롤백 PR 생성, 알림 수신 | X8 |
| **M4 (게이트)** | 선행조건 X1: `promote.yml`(WO-10-29 PR-3) + WO-11-03 확정 | 에이전트 PR 이 prod 에 도달하는 경로가 승인 단계에서 막힘을 시연 | James |
| **M5 (보류)** | 트랙 B: strategist·executor | Q8 결정 후 별도 PRD v1.2 | M2, M3, M4, Q8 |
| M6 | 신뢰 확대(L1) | 기록을 보고 James 결정 | M5 |

## 5. 이슈 목록 (M0~M3, 1이슈=1PR)

R30 에 따라 이슈마다 WO 를 먼저 만든다. 각 이슈는 PR 네 칸을 채운다.

| # | 제목 | 마일스톤 |
|---|---|---|
| 1 | WO front matter 스키마 + CI 검증 | M0 |
| 2 | `docs/agent-loop/program.md` 템플릿 + `docs/ops/agent-loop/` 골격 | M0 |
| 3 | 추천 출처 보존(`auto_added` 덮어쓰기) 설계 | M1 |
| 4 | `recommendation_feedback` 컬럼 추가 DDL + 쓰기 경로 배선 + 서빙 시 기록 | M1 |
| 5 | FE 이벤트(클릭·시청 시작/완료·저장·건너뛰기) 호출처 + URL 계약 테스트 | M1 |
| 6 | 오프라인 기준선(최신순·무작위) 재구성 스크립트 | M1 |
| 7 | `insighta-eval` repo 골격 + 라벨 도구 | M1 |
| 8 | 지표 재현: 지연·거르기 오탐/미탐·수집 성공률 | M1 |
| 9 | CI: 테스트 조작 탐지 잡 | M2 |
| 10 | CI: 금지 경로 탐지 + CODEOWNERS 초안 | M2 |
| 11 | evaluator v0 (Actions, 일회용 DB, cacheOnly) | M2 |
| 12 | Keel: 에이전트 루프 검사 + 알림 채널 | M3 |
| 13 | `rollback.yml` 연동(롤백 PR 생성) | M3 |

이슈 3·4 는 DB 규칙(로컬→prod, raw SQL DDL, silent fail 검증, write path 전수 검토)이 적용된다.

## 6. 위험 (v1.0 §10 갱신)

| 위험 | 대응 |
|---|---|
| R01 위반 | 트랙 분리, B 는 결정 전 보류. (정정: `llm-call-ledger` 는 존재하지 않는다. 새 LLM 경로를 막는 CI 장치는 현재 없고 v1.2 에서 신설 대상) |
| 머지=prod 변경 | M4 게이트. 그 전에는 에이전트 PR 자동 머지 없음 |
| 지표 조작 | 라벨 분리(private repo), CI-2, WATCH-3 (유지) |
| 표본 부족 | 오프라인 평가 주 지표, 구간 보고, 100명 테스트 시 재설계 |
| 추천 출처 소실 | MEAS-5 |
| 규칙 이중화 | program.md 에서 규칙 제거 |
| 훅이 원격에 없음 | 집행은 CI 로 이동 (X2) |
| 측정 잡음 | ABAB+MAD, 임계는 실측 후 |

## 7. §11 미결정 사항 (갱신)

| # | 질문 | 상태 | 막히는 것 |
|---|---|---|---|
| **Q8** | LLM 을 쓰는 역할(strategist 등)을 허용할 것인가, 허용한다면 방식은 (a) R01 개정 / (b) 구독 세션·클라우드 루틴 / (c) 안 쓴다? | **신규** | 트랙 B 전부, G5 |
| **Q9** | (Q8=a·b 일 때) 월 상한과 승인 방식. 추가 비용 금지 규칙과의 관계 | **신규** | 트랙 B |
| Q1 | 가치 지표 한 문장 | 미답 | M1 완료, STRAT-5 |
| Q2 | 앱 repo 공개 범위: 현행 유지+eval 만 private 로 해도 되는가. GitHub 플랜 | 부분 확인(public, 플랜 불명) | GH |
| Q3 | k8s 종류·stg 분리 | **답 확인됨**: k3s 1노드, 네임스페이스 분리 (WO-10-29) | — |
| Q4 | 배포 방식 | **답 확인됨**: GitHub Actions → 봇 PR → Argo CD | — |
| Q5 | 작업 공간 | **신규 호스트 불필요** 권고(비용 금지). James 의 기존 환경 사용 | — |
| Q6 | Slack | **현재 없음.** 웹훅/앱 생성은 James. 대안 채널(GitHub 이슈 등) 허용 여부 | M3, 스크럼 |
| Q7 | 품질 지표 현재값·목표값 | 미답 | program.md |
| **Q10** | "M1–M9 타이밍 핀" 이 가리키는 구간 정의 (코드에서 못 찾음) | **신규** | MEAS-4 |
| **Q11** | 라벨링 100+ 개를 James 가 할 시간과 방식(CLI vs 내부 페이지) | **신규** | M1 |
| **Q12** | M4 선행조건(promote.yml, WO-11-03 DB 한 벌 정책) 일정 | **신규** | M5 |
| **Q13** | CODEOWNERS 코드 오너 리뷰 필수화 시 James 자신의 PR 을 어떻게 처리할지(`enforce_admins=false` 유지?) | **신규** | GH-2, CI-3 |
| **Q14** | `deploy.yml` 의 `migrate`·Edge Function 배포와 `terraform.yml` apply 를 "머지=실행"으로 둘지, 승인 단계를 둘지 | **신규** (WO-11-03 과 겹침) | M4 |

## 8. 승인 요청 범위

승인이 필요한 것: (1) 두 트랙 분리, (2) 트랙 A 의 M0~M3 착수, (3) Q8 방향, (4) G5 의 읽기 변경. 승인 전에는 코드·설정·이슈 생성을 하지 않는다.
