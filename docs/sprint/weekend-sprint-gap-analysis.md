# 주말 스프린트 하네스 — 현황과 차이 분석

- 작성: 2026-11-04 (수). 대상: James 의 제안서 "주말 48시간 스프린트 하네스" (2026-11-04).
- **원본 위치**: `docs/sprint/weekend-sprint-harness.md` 는 작업 트리 · `origin/main` 어디에도 없다(`ls docs/sprint` 실패, `git ls-tree` 0건). 이 문서는 James 가 대화에 붙여 넣은 본문을 원본으로 삼았다. 원본 파일이 다른 곳에 있으면 알려 달라.
- 근거 범위: `origin/main` @ `19b83735`, 이 세션의 읽기 전용 `gh` 결과(브랜치 보호 · 워크플로), repo 파일. 라이브 DB · 클러스터 조회 없음. 표기: 경로가 붙은 것은 읽은 사실, "추측"은 읽지 않고 추론한 것, "미검증"은 확인하지 못한 것.
- 이 단계에서 코드 · 설정 변경은 없다.

## 1. 제안서가 기대는 사실 (확인 결과)

| # | 제안서의 전제 | 확인 결과 | 근거 |
|---|---|---|---|
| F1 | main 머지 = prod 마이그레이션 · 배포 · terraform apply | **맞다, 단 이미지 배포는 한 단계 더 있다.** main 푸시 즉시 실행: prod DB 스키마 동기화(`migrate`), Edge Function 배포, terraform apply(`terraform/**` 변경 시, `-auto-approve`). 이미지는 봇이 만든 핀 PR 을 사람이 머지해야 배포된다 | `deploy.yml` 226 · 393 · 447, `terraform.yml` 132-157 |
| F2 | "sprint 브랜치 CI가 빨개지면 coordinator가 먼저 고친다" | **CI 가 돌지 않는다.** `ci.yml` 은 `pull_request` + `branches: [main]` 만 트리거하고 push 트리거는 제거되어 있다. `sprint/<date>` 로 가는 PR 과 push 에는 검사가 0개 | `ci.yml` 1-17행 |
| F3 | "GitHub 토큰은 이 repo 한정, 브랜치 push 와 PR 생성만 (sprint 브랜치 대상)" | **토큰 권한은 브랜치 단위로 제한되지 않는다.** main 보호: 필수 체크 8개(strict), PR 리뷰 필수 없음, 룰셋 없음, `enforce_admins=false`. James(admin) 의 토큰이면 보호를 우회해 main 에 직접 push 가능 → 즉시 prod 반영(F1). 비관리자 토큰도 PR 리뷰 필수가 없어서, 체크가 초록인 PR 을 main 으로 머지할 수 있다 | 이 세션의 보호 API 조회 결과(필수 체크 8개 · 리뷰 없음 · `enforce_admins` false · 룰셋 `[]`) |
| F4 | sprint 브랜치 push 가 다른 것을 일으키지 않는다 | 맞다. push 로 도는 워크플로는 `deploy`, `dataset-pipeline`, `notify-runbook`, `terraform` 이고 모두 `branches: [main]` 이다 | 워크플로 `on:` 블록 |
| F5 | R01 현행 그대로 | R01 개정안(#1766)은 미머지. 개정안도 "에이전트 루프 전용 API 키" 만 열고 **구독 세션의 무인 실행은 다루지 않는다**. 또 새 LLM 호출 경로를 막는 CI 장치는 **없다** (`llm-call-ledger` 는 존재하지 않음, `hardcode-audit` 는 OpenRouter 엔드포인트 선언만 탐지) | `docs/ops/rules-ledger.md`, `scripts/audit/hardcode-audit.ts:31-34` |
| F6 | 세션은 worktree 하나씩 | `scripts/worktree-setup.sh` 는 메인 체크아웃 경로를 `MAIN="/Users/jeonhokim/cursor/insighta"` 로 **하드코딩**한다. 컨테이너에서는 그대로 못 쓴다. 이 스크립트는 `node_modules` 를 메인에서 심링크하는 구조 | `scripts/worktree-setup.sh` |
| F7 | 일회용 dev container | **`.devcontainer/` 가 repo 에 없다**(파일 읽기 실패). 설치 절차는 `npm run install:all` + `npx prisma generate && npx prisma db push` 이므로 DB 가 필요하다 | `CONTRIBUTING.md` 5-10행 |
| F8 | worker 2~3개 + coordinator + verifier 병렬 | 메모리: ts-jest 워커 1개가 약 2.0GB 를 쓰고(2026-09-02 실측), 로컬은 `LOCAL_MAX_WORKERS=3` 으로 제한한다. **`CI` 환경변수가 있으면 제한이 풀려 코어 수 − 1 개가 뜬다.** 개발 머신(24GB)은 이 한도에서도 스왑에 들어간 전력이 있다 | `jest.config.ts` 3-13행 |
| F9 | 세션이 repo 규칙 훅 아래에서 돈다 | 훅(`email-send-guard`, `verify-gate`, `ssh-ec2-guard`, `git-rm-guard`, `git-destructive-snapshot`, `memory-guard`)은 **`.claude/settings.local.json`(미추적)에만 배선**되어 있다. 새 환경에는 없다 | 훅 목록 조사 결과 |
| F10 | 별도 EC2 / Ultra 업그레이드 | 별도 EC2 = 새 상시/일회 지출. 노드 증설 · 동급 비용 증가는 R32(개정안 #1768) 대상. 시장 검증 전 추가 비용 불가(2026-10-29). 플랜 전환은 James 가 결제 주체 | `rules-ledger.md`, memory |
| F11 | 검증은 로컬 DB · 시드 · 브라우저 흐름 | 클러스터 검증은 불가: 가용 메모리 약 240~340MB, 스테이징은 main 머지 후에만 갱신된다. 즉 스프린트 `verify` 는 컨테이너 안에서 끝나야 한다 | `current-state.md` §2 · §3 |
| F12 | `initiative.md` 에 설문 결과를 둔다 | **repo 는 public** 이다. `.gitignore` 는 `docs/spec/` · `docs/design/` 등 내부 문서만 제외하고 `docs/sprint/` 는 제외하지 않는다. 설문 응답 원문이 들어가면 그대로 공개된다 | `.gitignore` 148-160행 |
| F13 | features.json 으로 과제 관리 | 코드 변경에는 작업 오더가 필수다(R30). 완료는 prod 확인까지(R07). 기존 체계: `docs/work-orders/` 19건 + `QUESTIONS.md` + `digest.sh` | `rules-ledger.md` R07 · R16 · R30 |
| F14 | 알림은 GitHub 모바일로 대신 | 가능하나 F2 때문에 "CI 실패" 알림은 sprint 브랜치에서 생기지 않는다. Slack 은 아직 없다(앱 연결 전). 자동 알림은 R02 허용 목록(#1768 개정안) 범위 안에서만 | PR #1768 |
| F15 | 월요일에 M0 이후 main 반영 | M0(promote 분리)는 PR-A 가 진행 중이고 PR-B · D · E 는 James 의 설정 · 머지가 필요하다. 월요일(11-09)까지 끝나기는 어려워 보인다(추측) | PRD v1.2 §3 |
| F17 | 무인 세션의 인증과 권한 | 공식 문서(authentication, devcontainer): ① 환경에 `ANTHROPIC_API_KEY` 가 있으면 `claude -p` 는 **항상 그 키를 써서 API 과금으로 바뀐다**(제안서 §6 의 금지가 맞다). ② CI 용 구독 인증은 `claude setup-token` 으로 만드는 `CLAUDE_CODE_OAUTH_TOKEN` 이며 유효기간 1년, 모델 요청만 가능. ③ 무인 세션은 로그인이 만료되어 갱신 못 하면 멈춘다. ④ 구독 인증의 무인 · 병렬 실행을 금지하는 서술은 문서에서 찾지 못했다(허용한다는 서술도 아님). ⑤ 참조 dev container 는 `devcontainer.json` · `Dockerfile` · `init-firewall.sh` 3개이고 방화벽에 `NET_ADMIN` · `NET_RAW` 가 필요하며 비루트 사용자여야 한다. ⑥ 문서는 권한 우회 플래그(`--dangerously-skip-permissions`)를 쓰는 환경에서도 `~/.claude` 자격 증명 유출은 막지 못한다고 경고한다. 병렬 세션용 `claude --worktree <name>` 옵션이 있다 | code.claude.com authentication · headless · devcontainer · common-workflows |
| F16 | UI 과제 | R08: 프런트엔드 변경은 `/verify` PASS 없이 push 금지. R10: D&D 수정 금지. 컨테이너에서 브라우저 검증이 되는지는 미검증 | `CLAUDE.md` |

## 2. 절별 분류

| 제안서 절 | 분류 | 사유 |
|---|---|---|
| §0 main 머지 금지, sprint 브랜치까지만 | 수정 채택 | 의도는 맞다. 그러나 토큰이 main 에 닿을 수 있어(F3) 금지가 규칙 문장에 그친다. 토큰 격리를 집행 장치로 추가 |
| §0 prod 자격 증명 없음 | 그대로 채택 | |
| §0 R01 현행 금지 / 실행 수단 구독 세션 | 수정 채택 | 구독 무인 세션이 R01 의 허용 범위인지 문서에 없다(F5). 확인 1건 + 생성 코드의 LLM 호출 경로 검사를 추가 |
| §0 테스트 삭제 · skip 금지 | 수정 채택 | CI 가 없으므로(F2) 집행 장치가 없다. 사후 diff 검사 스크립트 필요 |
| §1 일회용 환경, 자격 증명 마운트 금지 | 수정 채택 | 별도 EC2 는 R32 · 비용 규칙에 걸린다(F10). 컨테이너 파일이 repo 에 없고(F7) worktree 스크립트가 경로에 묶여 있다(F6) |
| §1 샌드박스 키 3종 | 그대로 채택 | 세 키 모두 공식 문서에 실재한다: `sandbox.failIfUnavailable`, `sandbox.allowUnsandboxedCommands`, `sandbox.network.strictAllowlist`. 허용 도메인 목록 자체는 `sandbox.network.allowedDomains`. 아래 F17 |
| §2 coordinator / worker / verifier | 수정 채택 | 구조는 맞다. 메모리 한도(F8)로 동시 무거운 실행 수를 제한해야 한다 |
| §3 이니셔티브 · features.json · 진행 파일 | 수정 채택 | 과제를 작업 오더에 1:1 로 묶는다(F13). 설문 원문은 공개 repo 에 두지 않는다(F12) |
| §3 CLAUDE.md 보강 | 수정 채택 | 추적되는 CLAUDE.md 에 스프린트 규칙을 넣으면 main 으로 같이 올라갈 수 있다. 추적되지 않는 오버레이로 |
| §4 완료 = verify + 테스트 + verifier → `passes: true` | 수정 채택 | R07 에서 "완료"는 prod 확인까지다. 스프린트 상태 이름을 분리 |
| §4 2회 실패 → blocked, 보수적 결정 | 그대로 채택 | `needs-james` 는 `QUESTIONS.md`(R16) 큐와 연결 |
| §4 스키마 추가만 | 수정 채택 | 로컬 DB 만 있으므로 raw SQL DDL 동봉과 `\d` 검증까지만 가능. prod 검증은 이후 |
| §4 CI 빨개지면 우선 수정 | 수정 채택 | CI 가 없다(F2). 트리거 확장 PR 또는 컨테이너 내 동일 명령 실행 |
| §5 3시간마다 progress.md | 그대로 채택 | |
| §5 알림 대체, 재시작 감시 스크립트 | 수정 채택 | F14. 재시작 상한 · 백오프 · **정지 스위치**를 추가 |
| §6 사용량 70% 에서 worker 감축 | 판단 불가 | 세션이 자신의 사용량을 읽는 방법을 찾지 못함(미검증) |
| §6 Ultra / Max 선택 | 판단 불가 | 공식 문서는 구독 등급으로 "Pro, Max, Ultra" 를 적고 세션 한도 · 주간 한도 메시지를 언급하지만 **수치를 싣지 않고, 어떤 등급이 5시간 한도를 없앤다는 서술도 찾지 못했다.** 제안서의 "Ultra 는 5시간 한도 없음 · 주간 한도 Pro 의 10배" 는 문서로 확인되지 않았다. 수치는 요금 페이지에서 James 가 확인 |
| §7 월요일 리뷰 · 회고 | 그대로 채택 | |
| §7 main 반영 방식 | 수정 채택 | 소형 PR 수동 머지의 안전 조건을 구체화(`scope` 판정으로 스키마 · Edge Function · terraform 무변경인 PR 만) |
| §8 성과 지표 | 그대로 채택 + 추가 | R01 · R32 위반 탐지 건수, CI 부재 구간의 사후 검사 실패 수 |
| §9 S1~S5 | 그대로 채택 + 추가 | S6~S8 추가 |

## 3. 제안서에 없지만 필요한 것

| # | 항목 | 이유 |
|---|---|---|
| X1 | 토큰 격리(별도 신원 또는 별도 repo) | F3. 가장 큰 위험 |
| X2 | 정지 스위치 | 무인 48시간. 토큰 폐기가 최종 정지이고, 그 전에 가벼운 정지 수단 필요 |
| X3 | sprint 브랜치 검사 수단 | F2 |
| X4 | 생성 코드의 LLM · 외부 API 경로 검사 | F5. R01 · R27 을 집행할 장치가 없다 |
| X5 | 비밀 정보 · 설문 원문의 공개 repo 유출 점검 | F12 |
| X6 | 드라이런 | 금요일에 샘플 과제 1개를 컨테이너에서 끝까지 |
