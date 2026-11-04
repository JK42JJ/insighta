# PRD v1.2 — Insighta 상시 에이전트 개선 루프 (James 검토 반영)

- 상태: **트랙 A 승인됨 (2026-11-04). 트랙 B 는 R01 개정 PR 머지 후.**
- v1.1(`PRD-v1.1.md`)에서 바뀐 부분만 적는다. 적지 않은 FR 은 v1.1 그대로다.
- 근거: James 의 v1.1 검토 답변(2026-11-04), `current-state.md`, `gap-analysis.md`, promote 설계 조사(§4).

## 1. 결정 반영

| 질문 | James 결정 | v1.2 반영 |
|---|---|---|
| Q8 | (a) R01 개정. 별도 `agent-loop` 워크스페이스, 월 $100 한도(Max 포함 크레딧 범위), 자동 충전 끔 | 개정안 PR #1766 (머지는 James). 머지 + 콘솔 설정 확인 전에는 **LLM 호출 0** |
| Q9 | 월 상한 $100 + 일일 카운터 $3. 변경은 James 승인 | R01 개정안에 명시. 일일 카운터 집행(Keel 검사)은 트랙 B 이슈로 "예정" |
| Q14 | 구조 변경: main 머지는 **stg 배포까지만**. prod 마이그레이션 · Edge Function · terraform apply 는 promote 단계로 이동 | M0 로 승격(§3). 설계안 §4 |
| Q12 | `promote.yml` + WO-11-03 을 M0 최우선. 완료 전 에이전트 PR 머지 금지(M4 게이트 유지) | 게이트가 M0 완료 조건이 됨. 공개 범위는 이 설계와 함께 결정 |
| Q13 | James 의 PR 은 ruleset 우회 목록에 James 만. 에이전트 App 은 우회 금지 | §5 |
| Q11 | 라벨 50개로 1차 기준선, 이후 100개. 라벨링 도구는 최소 기능 | MEAS-3 수정 |
| Q10 | M1–M9 정의 문서는 별도 제공. 그 전까지 M1–M9 관련 FR 보류 | §2 보류 목록 |
| Q1 | 별도 답변 | **이 세션에서는 수신하지 못했다.** 전달 받으면 `program.md` 에 반영. 그 전까지 STRAT-5(지표가 비면 추천 변경 과제 금지)가 적용된다 |
| 확인 | public repo 는 Environments required reviewers 사용 가능 | v1.1 의 "미검증" 해소 |

## 2. 트랙 A 범위 변경

**진행(승인됨)**: 상태 파일 골격, 측정(M1–M9 무관 부분), CI Guard, evaluator, watcher.

**보류(Q10 정의 문서 도착까지)**
- MEAS-4 중 M1–M9 타이밍 지표.
- EVAL-3 지연 지표(ABAB + MAD)와 거기에 쓰이는 임계 실측.
- 이슈 #8 중 지연 부분. 거르기 오탐/미탐과 수집 성공률은 M1–M9 와 무관하므로 진행한다.

**MEAS-3 (라벨)**
- 1차 기준선은 라벨 50개. 신뢰구간을 함께 보고하고 폭이 넓다는 점을 결과에 명시한다.
- 이후 100개로 확대.
- 도구는 최소 기능: 카드 표본 표시 → "볼 만하다 / 아니다" 기록 → `insighta-eval` 에 JSONL 추가. 통계 · 대시보드 · 계정 체계는 만들지 않는다.
- 라벨은 사람만(R01 개정안도 평가 데이터에 LLM 사용을 금지).

**신규 선행: LLM 호출 경로 탐지 장치** — 현재 `hardcode-audit` 의 `openrouter-endpoint-redeclared` 만 있고 Anthropic 직접 호출은 탐지하지 않는다(`llm-call-ledger` 는 존재하지 않음, 정정). 트랙 B 시작 전 Anthropic 엔드포인트 규칙과 허용 경로 목록을 추가한다. 허용 목록 변경은 James.

## 3. 마일스톤 (순서 변경)

| M | 내용 | 완료 조건 | 비고 |
|---|---|---|---|
| **M0 (최우선)** | promote 분리 + WO-11-03 | 아래 PR-A~E. 마지막 검증: 문서만 바꾼 머지가 prod 를 바꾸지 않고, 다음 실제 머지도 prod 를 바꾸지 않음 | 완료 전 에이전트 PR 머지 금지 |
| M0b | 상태 파일 골격(WO 스키마, program.md 빈 템플릿) | 기존 WO 19건이 스키마 검증을 깨지 않음 | M0 와 병행 가능(스택이 다름) |
| M1 | 측정 기반 — 이벤트 배선, 출처 보존, 오프라인 기준선, 라벨 도구, 거르기 · 수집 지표 | 현재 추천 vs 기준선 점수 1회(라벨 50개, 구간 포함) | M1–M9 지표 제외 |
| M2 | CI Guard + CODEOWNERS 초안 + evaluator v0 | 위반 테스트 PR 5개 차단, James PR 3개 판정 일치 | 지연 지표 판정은 Q10 후 |
| M3 | watcher (Keel 확장, 알림 채널, 롤백 PR) | 일부러 낸 stg 에러에서 롤백 PR 생성, 알림 수신 | 알림 채널 선행 |
| M5 | 트랙 B | R01 개정 머지 + 콘솔 한도 설정 확인 + LLM 호출 탐지 장치 | 별도 PRD 개정 |

### M0 PR 분해 (설계 조사 결과, `deploy.yml` · `terraform.yml` 인용은 origin/main 기준)

현재 prod 를 건드리는 것: `deploy.yml` 의 `deploy-edge-functions`(226-251행), `migrate`(393-445행), `publish-tags`(447-615행), 프론트 prod 빌드 단계(332-345행, 이미지 푸시만), 그리고 `terraform.yml` 의 apply(132-157행, 푸시 즉시 `-auto-approve`). 스테이징 잡(`migrate-staging`, `publish-staging-tags`, `smoke-staging`, `e2e-staging`)은 main 머지에 남긴다.

| PR | 내용 | 검증 | 머지 |
|---|---|---|---|
| PR-A | `promote.yml` 골격: `workflow_dispatch(sha, reason, components)`, gate(해당 sha 의 deploy.yml 실행에서 `smoke-staging` · `e2e-staging` 성공 확인, **건너뜀 = 실패**), 변경 잡은 `echo` 스텁 | 빨간 sha 로 실행 → gate 실패, 초록 sha → 통과. prod 시크릿 미사용 | 안전(가역) |
| PR-B | `Production` 환경에 required reviewer 설정 | 설정 화면 확인 | **James** (설정) |
| PR-C | WO-11-03 P1: additive-only 스키마 검사를 `ci.yml` 에 추가 | 컬럼 삭제 PR 로 실패 확인 | 안전 |
| PR-D | promote 에 실제 잡 연결: `migrate`, `edge`, `pin-images` | `components=images` 로 무변경 sha 실행 | **James** |
| PR-E | `deploy.yml` 에서 prod 잡 제거, `terraform.yml` apply 트리거를 `workflow_dispatch` 로 | 문서만 바꾼 머지 → prod 무변화, 다음 실제 머지 → prod 무변화 | **James** (가장 위험). 롤백 = revert 하면 승인 없는 경로가 되살아남 |

주의(설계 조사):
- `workflow_dispatch` 는 파일이 기본 브랜치에 있어야 실행되므로 PR-A(스텁)가 먼저 들어가야 이후 검증이 가능하다.
- 환경 이름이 `Production`(존재) 과 `production`(terraform.yml) 로 다르다. 대소문자 무시 여부는 추측이며 확인이 필요하다.
- `deploy-production` concurrency 그룹을 `rollback.yml` 과 공유한다. 승인 대기 중이면 사고 시 롤백이 막힐 수 있다(Q16).
- PR-E 전에 진행 중인 deploy 실행이 없는지 확인한다(옛 `migrate` 가 돌 수 있음).
- 프론트 prod 번들 빌드는 main 머지에 남긴다. 푸시만 하고 배포하지 않으며, WO-11-03 P2 전까지 stg 프론트는 별도 빌드(`stg-<sha>`)다.

## 4. GitHub (FR-GH-2 / Q13)

- 현재: 클래식 브랜치 보호(필수 체크 8, strict), 룰셋 없음, `enforce_admins=false`.
- 요청: James 의 PR 만 우회, 에이전트 App 은 우회 금지.
- **미검증**: 개인 계정 소유 repo 에서 룰셋 우회 대상을 "특정 사용자 한 명"으로 지정할 수 있는지. 불가하면 repository admin 역할(James 가 유일한 admin)로 지정하는 것이 같은 효과다 — GitHub 설정 화면에서 확인 필요.
- CODEOWNERS 코드 오너 리뷰를 필수로 걸면 James 본인의 PR 에서 리뷰어가 없어지므로, 위 우회 설정이 먼저다. 에이전트 PR 은 App 작성이라 James 가 승인할 수 있다.
- 적용은 James. 초안 PR 만 만든다.

## 5. 이슈 목록 (갱신)

1~13 은 v1.1 그대로이되 다음을 바꾼다.

| 변경 | 내용 |
|---|---|
| 앞에 추가 | P-A ~ P-E: 위 M0 PR 분해 |
| #8 | 지연 지표 부분 보류(Q10) |
| #11 | evaluator v0 는 정확도 지표 먼저, 지연 판정은 Q10 후 |
| 신규 #14 | Anthropic 엔드포인트 탐지 규칙 + 허용 경로 목록(`hardcode-audit`) — 트랙 B 선행 |
| 신규 #15 | Keel 일일 $3 카운터 검사 — 트랙 B |

이슈를 만드는 시점: M0 의 P-A~P-E 먼저. 나머지는 M0 진행 중에 차례로.

## 6. 남은 질문 (James)

| # | 질문 | 막히는 것 |
|---|---|---|
| Q1 | 가치 지표 한 문장 (별도 답변 중, 미수신) | M1 완료 판정, STRAT-5 |
| Q7 | 품질 지표 현재값 · 목표값 | program.md |
| Q10 | M1–M9 정의 문서 | MEAS-4 지연, EVAL-3 |
| Q15 | terraform apply 를 promote 에 포함하나, 별도 수동 dispatch 로 두나 (설계 권고: 별도) | PR-E |
| Q16 | `rollback.yml` 에도 승인 게이트를 거나, 사고 시 승인 없이 가능하게 하나 (같은 concurrency 그룹이라 대기가 롤백을 막을 수 있음) | PR-D/E |
| Q17 | 문서 · 차트만 바뀐 커밋처럼 E2E 가 건너뛰어진 sha 를 promote 해도 되나, 항상 가장 최근 초록 sha 만 허용하나 | PR-A gate |
| Q18 | `Production` 과 `production` 환경 이름 불일치는 의도인가 | PR-B |
| Q19 | WO-11-03 P2(DB 한 벌) 전에 스키마가 바뀐 sha 를 promote 할 수 있나 (stg E2E 가 아직 prod DB 가 아닌 stg DB 로 돎) | PR-D |
| 확인 | Q8 의 "Max 포함 월 $100" 크레딧의 정확한 범위 | R01 개정 문구 |

## 7. 승인 요청

- 이 문서 PR 머지(문서만).
- PR-A 착수(스텁 워크플로, 가역). PR-B · D · E 는 James 작업 또는 머지.
