# 주말 48시간 스프린트 하네스 v1.1 (초안, James 승인 대기)

- 상태: **DRAFT.** 승인 전에는 코드 · 설정 · 브랜치 · 토큰을 만들지 않는다.
- 기반: James 의 v1.0 제안서(2026-11-04), `weekend-sprint-gap-analysis.md` (사실 F1~F17).
- 일정 가정(수정 필요하면 알려 달라): 오늘 수요일 11-04 → **금요일 11-06 준비**, 토 · 일 11-07 ~ 08 실행, 월요일 11-09 리뷰. 통합 브랜치 `sprint/2026-11-07`.
- 이니셔티브(S1)는 James 가 따로 준다. 이 문서는 이니셔티브 내용과 무관한 하네스만 다룬다.
- 목표(월요일에 James 가 리뷰할 수 있는 PR 묶음)와 금지선(main 머지 금지, prod 자격 증명 없음)의 의도는 바꾸지 않았다.

## 1. v1.0 에서 달라진 큰 틀 (4가지)

1. **"main 머지 금지"를 규칙 문장이 아니라 토큰으로 집행한다.** 지금 main 은 PR 리뷰 필수도 룰셋도 없고 관리자 우회가 열려 있어서(F3), 무인 세션에 줄 수 있는 토큰이 main 에 닿는다. main 에 닿으면 곧바로 prod DB 동기화와 Edge Function 배포가 실행된다(F1). *이유: 가장 큰 위험이 v1.0 에서는 문장 하나였다.*
2. **sprint 브랜치에는 CI 가 없다는 것을 전제로 설계한다.** `ci.yml` 은 main 대상 PR 만 검사한다(F2). 검사 트리거를 넓히거나, 컨테이너 안에서 같은 명령을 돌린다. *이유: "CI 가 빨개지면"이라는 루프 규칙이 성립하지 않는다.*
3. **새 체계를 만들지 않고 작업 오더에 얹는다.** features.json 은 오더의 색인이고, `done_when` · `verify` 는 각 오더(R30)의 "검증 기준"에 둔다. blocked · needs-james 는 `QUESTIONS.md`(R16)로 간다. *이유: 코드 변경에 오더가 필수이고, 체계가 둘이면 어긋난다.*
4. **스프린트의 "통과"와 R07 의 "완료"를 다른 단어로 쓴다.** 스프린트 안에서의 통과는 `sprint-verified`, "완료"는 prod 확인 뒤에만. *이유: 컨테이너 검증은 prod 확인이 아니다(F11).*

## 2. 섹션별 수정안 (v1.0 → v1.1, 한 줄 사유)

### 2.1 전제와 금지선 (v1.0 §0)

| 항목 | v1.1 | 변경 사유 |
|---|---|---|
| main 머지 | 금지 유지. **집행 = 스프린트 토큰이 main 에 쓸 수 없음**(§2.2 T1 또는 T2). 토큰 격리가 확인되기 전에는 시작하지 않는다 | F3 |
| prod 자격 증명 | 없음 유지. 추가로 **서비스용 API 키 · agent-loop 키 · `ANTHROPIC_API_KEY` 를 환경에 두지 않는다** | F17①, R01 |
| LLM API 호출 | R01 현행 그대로. **스프린트가 만드는 코드에도 새 LLM · 외부 API 호출 경로를 추가하지 않는다.** verifier 가 diff 에서 `api.anthropic.com`, `@anthropic-ai/sdk`, `openrouter.ai`, `ANTHROPIC_API_KEY`, `OPENROUTER` 를 검색해 0건을 확인한다. 발견 시 `blocked` | F5. CI 장치가 없다 |
| 실행 수단 | Claude Code 세션(James 구독). **구독 인증은 `claude setup-token` 으로 만든 `CLAUDE_CODE_OAUTH_TOKEN`** (유효 1년, 모델 요청만 가능). 구독 무인 세션이 R01 의 허용 범위인지는 S6 | F5, F17 |
| 테스트 | 삭제 · skip · 약화 금지. **집행 = coordinator 가 PR 마다 diff 검사**(`.skip`, `.only`, 테스트 파일 삭제, 단언 수 감소, mock 증가). PRD 의 CI-2 잡이 생기면 대체 | F2 |
| 신규 | 비가역 행위 금지 목록에 **노드 · 인스턴스 · 유료 플랜 · 외부 서비스 가입(R32 · R27)** 추가. 필요해지면 `needs-james` | 규칙 정합 |

### 2.2 실행 환경 (v1.0 §1)

| 항목 | v1.1 | 변경 사유 |
|---|---|---|
| 환경 | 일회용 환경 유지. 선택지 3가지와 사실은 S2 | 별도 EC2 는 지출 결정(R14 · R32) |
| 컨테이너 정의 | **`.devcontainer/` 신설**(Claude Code 참조 구성의 `devcontainer.json` · `Dockerfile` · `init-firewall.sh` 를 기반으로). 비루트 사용자, `NET_ADMIN`/`NET_RAW`, 자격 증명 · `~/.ssh` 마운트 없음 | F7, F17⑤ |
| 샌드박스 | `sandbox.failIfUnavailable: true`, `sandbox.allowUnsandboxedCommands: false`, `sandbox.network.strictAllowlist: true`. 허용 도메인은 `sandbox.network.allowedDomains` 에 npm · GitHub · Anthropic · 테스트에 필요한 곳만. 세 키 이름은 공식 문서로 확인했다 | F17 |
| 토큰 (택1, S7) | **T1 별도 비공개 repo + 쓰기 deploy key**: 스프린트가 `insighta-sprint` 같은 별도 repo 에만 쓴다. 이 repo 에는 읽기만(public 이라 토큰 불필요). main 에 닿을 경로 자체가 없다. 월요일에 James 가 그 브랜치를 가져와 PR 을 연다 / **T2 이 repo 에 비관리자 신원(GitHub App 등) + main 룰셋 선행**: PR 승인 필수와 main 갱신 제한을 James 외 우회 불가로 건 뒤에만. PRD 의 Q13 · FR-GH-2 와 같은 설정 | F3 |
| 정지 스위치 | **토큰 폐기가 최종 정지.** 그 전에 가벼운 정지: 통합 브랜치에 `STOP` 파일이 생기면 감시 스크립트가 세션을 시작하지 않는다. James 가 모바일에서 할 수 있는 정지 수단을 금요일에 시험한다 | 무인 48시간 |
| worktree | 세션마다 `claude --worktree` 또는 `git worktree add`. **`scripts/worktree-setup.sh` 의 `MAIN` 하드코딩을 환경변수로 받게 고친다**(코드 변경, 금요일 PR) | F6 |
| 자원 | 동시에 도는 무거운 명령(jest · tsc · playwright)은 최대 N개(S2 에서 환경이 정해지면 확정). ts-jest 워커 1개 ≈ 2GB 이고 `CI` 환경변수를 켜면 워커 제한이 풀리므로, **컨테이너에서는 `CI` 를 설정하지 않거나 `--maxWorkers` 를 명시**한다 | F8 |
| 훅 | 컨테이너용 설정에 `memory-guard` 에 해당하는 자원 보호와 `git-destructive-snapshot` 을 포함. 기존 훅은 로컬 미추적 파일에만 있어 자동으로 따라오지 않는다 | F9 |

### 2.3 역할과 병렬도 (v1.0 §2)

| 항목 | v1.1 | 변경 사유 |
|---|---|---|
| 구성 | coordinator 1 + worker 2 + verifier 겸용 1 (처음에는 worker 2, 드라이런에서 자원이 남으면 3) | F8 |
| coordinator | 코드를 쓰지 않는다(유지). **PR 마다 §2.1 의 diff 검사를 수행**하고 sprint 브랜치로 머지 | F2 |
| verifier | 새 맥락 · 작성자와 다른 세션(유지). 추가: LLM 경로 검색(§2.1), `.skip` 검사, `verify` 재실행 | F5 |
| 파일 소유 | 과제마다 소유 파일을 정하고, **같은 파일을 다시 여는 과제는 한 과제로 합치거나 `depends_on` 으로 직렬화**(R21) | 충돌 방지 |

### 2.4 금요일 준비 산출물 (v1.0 §3)

| 항목 | v1.1 | 변경 사유 |
|---|---|---|
| 이니셔티브 | `docs/sprint/2026-11-07/initiative.md` 는 **요약만** 커밋. 설문 응답 원문 · 응답자 정보는 공개 repo 에 두지 않는다(S8) | F12 |
| 과제 | `features.json` = 색인(`id`, `wo`, `depends_on`, `files`, `status`). 각 과제는 `docs/work-orders/WO-2026-11-07-<slug>.md`. `done_when` · `verify` 는 오더의 "검증 기준"(실행 가능한 명령 + 기대값) | R30, F13 |
| 크기 | 1~2시간 안에 끝나는 크기(유지). 영역이 겹치지 않게(유지) | |
| 검증 수단 점검 | 금요일에 **모든 `verify` 를 컨테이너에서 실행**해 PASS 한 것만 남긴다(유지). 브라우저 · DB 가 필요한 `verify` 는 컨테이너에서 도는지 따로 확인. 안 돌면 그 과제는 제외 | F11, F16 |
| 규칙 주입 | 추적되는 `CLAUDE.md` 를 수정하지 않는다(main 으로 같이 올라갈 수 있다). 스프린트 규칙은 `docs/sprint/2026-11-07/RULES.md` 로 두고 **세션 시작 프롬프트에서 읽게** 한다. 추적되지 않는 오버레이 파일(`CLAUDE.local.md`)이 지원되는지는 문서 확인 전까지 쓰지 않는다 | 미검증 |
| 진행 파일 | `progress.md`, `decisions.tsv`(유지). `needs-james` 는 `QUESTIONS.md` 에도 한 줄 | R16 |

### 2.5 루프 규칙 (v1.0 §4)

| 항목 | v1.1 | 변경 사유 |
|---|---|---|
| 완료 정의 | `sprint-verified` = `verify` 통과 + 컨테이너에서 전체 테스트 통과 + verifier 확인 + §2.1 diff 검사 통과. PR 의 "Not verified" 에 **"prod 미확인"을 적는다**. "완료" 단어는 prod 확인 뒤 | R07 |
| 검사 | sprint 브랜치에는 CI 가 없으므로 (a) `ci.yml` 의 `pull_request.branches` 에 `sprint/**` 를 추가하는 작은 PR(금요일, James 머지) 또는 (b) 컨테이너에서 `npm run lint` · `typecheck` · 테스트 · `hardcode-audit` 를 CI 와 같은 순서로 실행하고 결과를 PR 에 붙인다. (a) 가 있어도 (b) 를 한다 | F2 |
| 실패 처리 | 같은 과제 2회 실패 → `blocked`(유지) | |
| 결정 | 보수적 선택 + `decisions.tsv`(유지). `needs-james` 대상에 추가: 의존성 신규 추가, 외부 API(R27), 새 LLM 경로(R01), 비용(R32) | 규칙 정합 |
| 스키마 | 추가만(유지). **raw SQL DDL 동봉, 컨테이너 DB 에서 `\d` 검증**(R06). prod · stg DB 에 접근하지 않으므로 write path 전수 검토 결과를 PR 에 적고 prod 검증은 월요일 이후로 명시 | R06 |
| UI 과제 | R08: 브라우저 검증(`/verify`) 없이 push 금지. **컨테이너에서 headless 브라우저 검증이 되기 전에는 UI 과제를 넣지 않는다.** D&D 는 R10 대로 금지 | F16 |
| CI/체크 우선순위 | 검사 실패 시 coordinator 가 다른 과제보다 먼저 처리(유지) | |

### 2.6 감시와 보고 (v1.0 §5)

| 항목 | v1.1 | 변경 사유 |
|---|---|---|
| 진행 파일 | 3시간마다 `progress.md` 갱신(유지). 추가: 마지막 갱신 시각 · 실행 중 세션 수 · 재시작 횟수 | |
| 알림 | GitHub 알림: repo 를 All activity 로 Watch 하거나 PR 에 James 를 reviewer 로 지정해야 James 에게 온다(기본값은 참여 · 멘션만, 추측). sprint 브랜치에는 CI 알림이 없다. Slack 은 연결 후 `#insighta-agent` 에만(R02 허용 목록) | F14 |
| 재시작 감시 | 재시작 상한(예: 시간당 N회)과 백오프를 둔다. 인증 만료로 멈추면 재시작해도 소용없으므로 **만료 시 중단 + progress 에 기록** | F17③ |
| 사용량 70% 감축 | 세션이 자기 사용량을 읽을 방법을 찾지 못했다(미검증). 대체: 시간대별 고정 병렬도(예: 토 오전 worker 2, 한도 오류가 나면 worker 1) | v1.0 §6 |

### 2.7 사용량 (v1.0 §6)

| 항목 | v1.1 | 변경 사유 |
|---|---|---|
| 한도 정보 | 제안서의 "Ultra: 5시간 한도 없음, 주간 한도 Pro 의 10배" 는 공식 문서에서 확인되지 않았다(문서는 Ultra 등급과 세션 · 주간 한도 개념만 언급, 수치 없음). James 가 요금 페이지에서 확인한 뒤 S3 결정 | F17 |
| 플랜 전환 | James 가 직접 결제하는 행위이므로 CC 의 승인 경로(R32)는 필요 없다. 월 결제를 쓸지는 James 의 지출 결정(R14) | |
| API 키 | `ANTHROPIC_API_KEY` 를 환경에 두지 않는다(유지). 키가 있으면 `claude -p` 는 항상 API 과금으로 바뀐다 | F17① |
| R01 개정의 $100 | 스프린트와 별개 풀인지 같은 풀인지 확인되지 않았다("Max 포함" 범위 미확정). S3 와 함께 확인 | |

### 2.8 월요일 (v1.0 §7)

| 항목 | v1.1 | 변경 사유 |
|---|---|---|
| 리뷰 | `progress.md` + 스프린트 PR 목록(유지) | |
| main 반영 | M0(promote 분리) 완료 후(유지). M0 는 James 의 설정 · 머지가 필요한 단계가 있어 월요일 완료는 어려워 보인다(추측, F15) | |
| 소형 PR 수동 머지(S4-b)의 안전 조건 | 다음을 **모두** 만족하는 PR 만: `prisma/**`, `supabase/functions/**`, `terraform/**`, `.github/**`, `charts/**` 변경 없음 / `deploy.yml` 의 `scope` 판정이 schema=false, Edge Function 배포 대상 아님. 이 경우 main 머지는 이미지 빌드와 핀 PR 생성까지만 일으키고, 배포는 James 가 핀 PR 을 머지할 때 일어난다. 위 경로를 건드리는 PR 은 M0 완료 뒤 | F1 |
| 회고 | blocked · 실패 원인을 intent-log · 규칙(CI 검사)으로 옮긴다(유지) | |

### 2.9 지표 (v1.0 §8)

유지하고 다음을 추가한다: R01 · R32 · R27 위반 탐지 건수(목표 0), CI 부재 구간에서 사후 검사가 잡은 실패 수, 재시작 횟수, `sprint-verified` 중 월요일 리뷰에서 수정 없이 머지 가능한 비율.

## 3. 금요일 세팅 체크리스트 (11-06)

범례: [J] James, [CC] 코드 변경 없는 준비, [PR] 코드 변경(승인 후 PR 로, 머지는 James). 시간은 추정.

### A. 결정과 설정 (James)
- [ ] [J] S1~S9 답변, 특히 S2 · S6 · S7 · S9 (아래 §4)
- [ ] [J] 토큰 방식 확정 후 발급. 값은 James 가 직접 입력하고 CC 에는 이름 · 위치만 알린다
  - T1: 별도 비공개 repo 생성 + 쓰기 deploy key
  - T2: 비관리자 신원 + main 룰셋(PR 승인 필수, main 갱신 제한, 우회 = James 만)
- [ ] [J] 구독 인증 토큰 생성(`claude setup-token`), 컨테이너 비밀로만 주입. 사용량 플랜 결정(S3)
- [ ] [J] GitHub 모바일 알림: repo Watch 설정과 reviewer 지정 규칙 확인
- [ ] [J] needs-james 확인 시간대(S5) 확정

### B. 컨테이너와 도구 (CC, 승인 후 PR)
- [ ] [PR] `.devcontainer/` 신설(devcontainer.json · Dockerfile · init-firewall.sh), 허용 도메인 목록
- [ ] [PR] `scripts/worktree-setup.sh` 의 `MAIN` 을 환경변수로 받게 수정
- [ ] [PR] (선택, 권장) `ci.yml` 의 `pull_request.branches` 에 `sprint/**` 추가
- [ ] [PR] 감시 스크립트(재시작 상한 · 백오프 · `STOP` 파일 · 인증 만료 시 중단)
- [ ] [CC] 샌드박스 설정 3키 + `allowedDomains` 를 컨테이너용 설정에 반영

### C. 스프린트 산출물 (CC + James 입력)
- [ ] [J → CC] 이니셔티브(S1) 수령
- [ ] [CC] `docs/sprint/2026-11-07/{initiative.md(요약), features.json, progress.md, decisions.tsv, RULES.md}`
- [ ] [CC] 과제별 작업 오더 `WO-2026-11-07-<slug>.md` (검증 기준 = 실행 가능한 명령 + 기대값)
- [ ] [CC] 통합 브랜치 생성(T1 이면 별도 repo, T2 이면 이 repo 의 `sprint/2026-11-07`)

### D. 드라이런과 시험 (CC, 가장 중요)
- [ ] [CC] 빈 컨테이너에서 clone → 설치 → DB 준비 → `npm run lint` · `typecheck` · 테스트 · `hardcode-audit` 가 통과하는지 실제 실행
- [ ] [CC] 샘플 과제 1개를 end-to-end: worker 세션 → 테스트 → PR → verifier 세션 → coordinator 머지
- [ ] [CC] 모든 과제의 `verify` 를 컨테이너에서 실행. PASS 하지 않은 과제는 제외
- [ ] [CC] **토큰 격리 시험**: 스프린트 토큰으로 main 에 push 와 PR 머지를 시도해 **거부되는 것**을 확인한다. 거부되지 않으면 시작하지 않는다
- [ ] [CC] **정지 스위치 시험**: `STOP` 파일, 토큰 폐기 후 세션이 멈추는지
- [ ] [CC] LLM · 외부 API 경로 검색(§2.1)이 샘플 PR 에서 실제로 동작하는지(고의로 넣은 호출을 잡는지)
- [ ] [CC] 인증 만료 · 사용량 한도 오류 시 스크립트가 어떻게 멈추는지 확인

### E. 시작 조건 (go / no-go)
다음 6개가 모두 확인되어야 시작한다. 하나라도 아니면 시작하지 않고 James 에게 알린다.
1. 토큰 격리 시험 통과(main 쓰기 거부)
2. 정지 스위치 시험 통과
3. 컨테이너 드라이런 통과(샘플 과제 end-to-end)
4. 시작할 과제의 `verify` 전수 실행 결과가 기록됨
5. 검사 수단(CI 트리거 확장 또는 컨테이너 실행)이 동작함
6. 환경에 `ANTHROPIC_API_KEY` · agent-loop 키 · prod 자격 증명이 없음(환경변수 목록 확인)

## 4. 질문 (S1~S9)

| # | 질문 | 막히는 것 | 확인된 사실 · 권고 |
|---|---|---|---|
| S1 | 이니셔티브(설문 결과 요약 + 원하는 결과) | 과제 목록 전부 | James 가 따로 준다 |
| S2 | 실행 환경: Codespaces / 별도 EC2 / James 맥북의 컨테이너 | 컨테이너 사양, 병렬도 | 별도 EC2 는 지출(R14 · R32 · 추가 비용 금지). 맥북은 메모리 천장(RAM 24GB + 스왑, jest 워커 약 2GB 씩, F8)이 있고 James 가 같은 기기로 다른 일을 한다. 맥미니는 GUI 세션이 없어 `claude -p` 를 못 돌리고(메모리, 2026-11-04) 자격 증명 보유 기기라 부적합. Codespaces 의 무료 할당 · 머신 사양 · 48시간 지속 가능 여부는 **확인하지 못했다**(James 가 계정 화면에서 확인) |
| S3 | 사용량: Ultra(a) / Max 유지(b) | worker 수, 5시간 한도 대응 | "Ultra 는 5시간 한도 없음" 은 문서로 확인되지 않았다. 요금 페이지에서 수치를 확인한 뒤 결정. R01 개정의 "Max 포함 $100" 과 같은 풀인지도 확인 |
| S4 | 월요일 main 반영: M0 완료 대기 / 소형 PR 수동 머지 | 월요일 이후 흐름 | 권고: 기본 (a) 대기, 예외로 §2.8 의 안전 조건을 만족하는 PR 만 (b). 스키마 · Edge Function · terraform · 워크플로 PR 은 대기 |
| S5 | needs-james 확인 시간대 | 질문 큐 운영 | 제안: 토 · 일 아침 · 저녁 각 10분(v1.0 그대로). 이 시간에 `QUESTIONS.md` 항목만 본다 |
| S6 | 구독 Claude Code 세션의 무인 실행이 R01 의 허용 범위(CC 콘솔 작업)인가 | 시작 가능 여부 | R01 개정안(#1766)은 API 키 경로만 열었다. 이전 Q8 의 (b) 안과 같은 해석 문제. 문서에는 구독 인증의 무인 · 병렬 실행을 금지하는 서술이 없다(허용 서술도 없음) |
| S7 | 토큰 격리: T1 별도 비공개 repo + deploy key / T2 비관리자 신원 + main 룰셋 | 시작 조건 1 | 권고: 룰셋(Q13)이 금요일까지 적용되지 않을 가능성이 크므로 T1. T1 은 비용 0이고 main 에 닿는 경로가 없다. 대신 월요일에 James 가 브랜치를 가져와 PR 을 연다 |
| S8 | 설문 데이터의 공개 범위 | `initiative.md` 위치 | repo 는 public 이다. 권고: 요약만 커밋, 원문은 `insighta-private`(비공개 미러)나 로컬에만 |
| S9 | 컨테이너 안 세션의 권한 방식: 권한 우회 플래그(방화벽 · 비루트 · 자격 증명 없는 컨테이너 한정) / 허용 규칙 목록만 | 무인 실행 가능 여부 | 무인 세션은 권한 확인에 응답할 사람이 없다. 공식 참조 구성은 전자를 전제하며, 문서도 그 경우에 `~/.claude` 자격 증명 유출은 막지 못한다고 경고한다. 그래서 **구독 토큰은 모델 요청만 되는 `setup-token` 을 쓰고, 허용 도메인을 좁힌다.** 선택은 James |

## 5. 위험

| 위험 | 대응 |
|---|---|
| 토큰이 main 에 닿아 prod 반영 | §2.2 T1/T2, 시작 조건 1 |
| 프롬프트 인젝션(이슈 · PR · 웹 내용)이 무인 세션을 조종 | 허용 도메인 최소화, 토큰은 모델 요청 전용, 자격 증명 마운트 없음, 외부 작성자 입력은 데이터로만 취급 |
| 생성 코드가 LLM · 외부 API 경로를 추가 | verifier 검색 + `needs-james` (CI 장치 없음) |
| 테스트 조작 | coordinator diff 검사, 월요일 James 리뷰 |
| 메모리 포화로 세션 정지 | 병렬도 제한, `CI` 변수 주의, 자원 보호 |
| 인증 만료 · 사용량 한도로 조용히 멈춤 | 감시 스크립트가 감지해 progress 에 기록 |
| 월요일에 한꺼번에 머지해 prod 장애 | §2.8 안전 조건, 소형 단위 |
| 설문 원문 공개 | S8 |

## 6. 이 문서가 확인하지 못한 것

- 원본 파일의 위치(작업 트리와 `origin/main` 에 없음).
- Codespaces 의 무료 할당 · 머신 사양 · 장시간 유지 여부, 컨테이너 안 DB(pgvector 포함)와 headless 브라우저 검증의 실제 동작.
- Ultra 등급의 한도 수치, R01 개정의 "Max 포함 $100" 과 스프린트 사용량이 같은 풀인지.
- 세션이 자기 사용량을 읽는 방법.
- 추적되지 않는 오버레이 파일(`CLAUDE.local.md`) 지원 여부.
- GitHub 알림 기본값(참여 · 멘션만이라는 것은 추측).
