# Codespaces 스프린트 환경 구축안

- 상태: 제안. 코드스페이스 · 저장소 · 토큰 · devcontainer 는 승인 전에 만들지 않는다.
- 근거: GitHub Codespaces 공식 문서 조사(요약 도구 경유 — 중요한 수치는 라이브 페이지로 재확인), Claude Code 공식 문서 조사, repo 조사. 확인하지 못한 것은 "미검증".

## 1. 구성도

```
James (GitHub 웹/모바일)
   │  STOP 파일 생성 · 구간 재시작
   ▼
[비공개 repo insighta-sprint]           ← 코드스페이스는 이 repo 에서 만든다
   .devcontainer/  scripts/sprint/  progress.md  decisions.tsv  features.json  STOP
   │
   ▼  코드스페이스 (12시간 구간, 비루트, 방화벽)
   /workspaces/insighta-sprint   (제어 repo)
   /workspaces/work/insighta     (공개 repo 를 토큰 없이 clone, 브랜치는 sprint remote 로만 push)
   ├─ coordinator 세션 ─ progress.md 갱신, worker PR 검사 · 통합 브랜치 머지
   ├─ worker 세션 ×2 ─ 과제 1개씩 (git worktree 또는 `claude --worktree`)
   └─ verifier 세션 ─ 새 맥락으로 판정
   (로컬 Postgres: 같은 컨테이너)
```

본 repo `JK42JJ/insighta` 에 쓸 수 있는 자격 증명은 코드스페이스에 없다.

## 2. 제약 (문서 기준)

| 항목 | 내용 | 영향 |
|---|---|---|
| 최대 수명 | 코드스페이스 1개는 **12시간**. 유휴 설정과 무관하고 사용 중에도 적용 | 48시간 연속 불가. 구간 4개로 나눈다 |
| 유휴 타임아웃 | 기본 30분, 사용자 설정 5~240분. 터미널 입력 · **출력**이 활동으로 인정 | 구간 시작 시 240분으로 설정. 세션 로그가 터미널에 계속 출력되면 유지될 가능성이 있으나 보장은 문서에 없다(미검증) |
| 중지 시 | 실행 중인 프로세스 종료. 파일은 유지 | 작업마다 commit · push, 구간 종료 전 정리 |
| 보존 | 비활성 코드스페이스는 기본 30일 뒤 삭제(0~30일 설정) | 스프린트 후 직접 삭제 |
| 무료 한도 | 개인 Free 월 120 코어시간 + 15GB-월 저장소, Pro 월 180 코어시간. 코어시간 = 시간 × 코어 수 | §3 |
| 한도 초과 | 결제 수단이 없으면 차단, 있으면 과금(문서: 2코어 시간당 $0.18, 코어시간당 약 $0.09, 저장소 GB-월 $0.07) | §3 |
| 비용 주체 | 코드스페이스를 만든 계정 | James 계정 |
| 비밀값 | 사용자 수준 비밀값을 환경변수로 주입. 빌드 시점에는 없음. **repo 를 골라 접근 허용** 가능 | 구독 토큰은 `insighta-sprint` 에만 허용 |
| 포트 | 기본 비공개 | 유지 |
| 저장소 접근 | 기본 토큰 범위는 문서에서 확정하지 못했다. `devcontainer.json` 의 `customizations.codespaces.repositories` 로 같은 계정의 repo 권한을 지정할 수 있다 | 시험 5 로 확인. 본 repo 는 목록에 넣지 않는다 |
| 머신 사양 | 2 · 4 · 8 · 16 · 32 코어. RAM · 디스크는 문서 조사에서 못 가져왔다. 기억으로는 4코어 16GB 이나 **미검증** | 생성 화면에서 확인 |
| Docker-in-Docker · compose | 문서 조사에서 못 확인 | Postgres 를 apt 로 설치하는 안을 1순위로 둔다 (§4) |

## 3. 비용과 구간

**구간(12시간 상한에 맞춤)**

| 구간 | 시간 | 시작 주체 | 비고 |
|---|---|---|---|
| ① | 토 09:00 ~ 21:00 | James (토 아침 확인) | 시작 직후 유휴 타임아웃 240분 설정 |
| ② | 토 21:00 ~ 일 09:00 | James (토 저녁 확인) | 야간. 사람 없음 |
| ③ | 일 09:00 ~ 21:00 | James (일 아침 확인) | 저녁에 James 가 출시분 머지 |
| 종료 | 일 저녁 머지 후 | James | 토큰 폐기 · 코드스페이스 삭제 (일요일 체크리스트 K) |

시작 방법: GitHub 웹에서 코드스페이스를 만들고(또는 중지된 것을 재개) `bash scripts/sprint/start.sh` 한 줄. 상태는 모두 `insighta-sprint` 에 있어서 새 코드스페이스에서도 이어진다. 구간 종료 1시간 전부터는 새 과제를 시작하지 않고 진행 중인 과제를 push 한다(`start.sh` 가 시각을 안다).

**추정 비용 (문서 단가 기준, 현재 월 사용량은 모름)**

| 머신 | 36시간 | 48시간 | 무료 한도 120 코어시간 대비 |
|---|---|---|---|
| 2코어 | 72 코어시간 | 96 코어시간 | 한도 안 (RAM 이 작아 병렬 불가, 추측) |
| 4코어 | 144 코어시간 | 192 코어시간 | 초과 24~72 코어시간 ≈ $2~7 (Free). Pro(180)면 초과 12 코어시간 ≈ $1 |
| 8코어 | 288 코어시간 | 384 코어시간 | 초과 168~264 코어시간 ≈ $15~24 |

저장소 비용과 prebuild 는 제외했다. 이 세션에서는 이번 달 사용량을 볼 수 없다.

**결정(S2', James 2026-11-04)**: (a) 4코어 + 결제 수단 등록 + 예산 상한 **$20**. 12시간 구간 3개를 유지한다.

**총 예상 코어시간(4코어)**

| 구간 | 시간 | 코어시간 |
|---|---|---|
| 목 verify 실행 | 약 3h | 12 |
| 금 시험 운전 + 소크 | 약 7h | 28 |
| 토 ① + ② + 일 ③ | 36h | 144 |
| 합계 | 약 46h | 약 184 |

무료 한도 120 코어시간(Free) 기준 초과 약 64 코어시간 ≈ $6, Pro(180)면 거의 0 이다(문서 단가, 저장소 비용 제외, 이번 달 기존 사용량 모름). **$20 상한이면 여유가 있으나** 상한에 닿으면 코드스페이스가 멈추므로 `progress.md` 에 누적 사용을 적고 상한의 70%에서 James 에게 알린다. 활성 구간만 켜는 안((b))은 쓰지 않는다.

## 4. devcontainer 구성안 (`insighta-sprint/.devcontainer/`)

Claude Code 참조 구성은 `devcontainer.json` · `Dockerfile` · `init-firewall.sh` 세 파일이다. 방화벽은 `NET_ADMIN` · `NET_RAW` 가 필요하고 세션은 **비루트** 여야 한다.

| 항목 | 값 |
|---|---|
| 베이스 | Node 20 (CI · `engines` 와 동일). 예: `mcr.microsoft.com/devcontainers/typescript-node:20` |
| apt | `ripgrep`, `jq`, `python3`, `make`, `g++`, `openssl`, `git`, PostgreSQL 클라이언트 + 서버 + pgvector (패키지 이름은 배포판에 따라 다르다 — 미검증) |
| DB | 컨테이너 안 PostgreSQL 서비스(Docker 불필요). `DATABASE_URL`/`DIRECT_URL` 은 로컬 접속 문자열(비밀 아님). Docker compose 안은 대안이며 코드스페이스 지원은 미검증 |
| 브라우저 | `npx playwright install --with-deps chromium` (CI 와 달리 시스템 라이브러리 필요) |
| 환경 | `ENCRYPTION_SECRET` 임의의 더미(32자 이상, 비밀 아님), `HUSKY=0` 은 쓰지 않는다(커밋 훅이 한글 커밋을 막는 것이 원하는 동작). 단 훅 부트스트랩 필요 |
| `CI` 변수 | **설정하지 않는다.** 설정하면 `jest.config.ts` 의 워커 상한(3)이 풀려 코어 수 − 1 개 워커가 뜬다 (워커 1개 ≈ 2GB) |
| 방화벽 | `init-firewall.sh` 로 허용 도메인만 통과: `registry.npmjs.org`, `github.com`, `api.github.com`, Anthropic 도메인(목록은 Claude Code 문서로 확인), Playwright 다운로드 호스트(설치 시점만). 컨테이너가 `NET_ADMIN` 을 받을 수 있는지는 **미검증** |
| 사용자 | 비루트 `remoteUser` |
| 자격 증명 | `~/.ssh`, 클라우드 자격 증명, `.env*` 마운트 없음. `ANTHROPIC_API_KEY` · 에이전트 루프 키 · prod 값 없음 |
| Claude Code 설정 | `sandbox.failIfUnavailable: true`, `sandbox.allowUnsandboxedCommands: false`, `sandbox.network.strictAllowlist: true`, `sandbox.network.allowedDomains` 에 위 도메인 (키는 공식 문서로 확인됨) |
| 설치 | `npm ci`, `npx prisma generate`, `cd frontend && npm install --no-package-lock --no-audit` |

**repo 의 하드코딩 (수정 필요, 금요일 PR 후보)**
- `scripts/worktree-setup.sh:15` — `MAIN="/Users/jeonhokim/cursor/insighta"`. 코드스페이스에서는 worktree 를 `git worktree add` + 필요 시 `npm ci` 로 직접 만들거나, `MAIN` 을 환경변수로 받게 고친다.
- `scripts/hooks/memory-guard.sh` — macOS 전용 `sysctl`. 컨테이너용은 별도로 만든다(동시에 무거운 명령을 2개로 제한하는 `flock` 기반).
- 조사 에이전트가 `.husky/`, 그 밖의 `scripts/` 의 `jeonhokim` 경로는 이 머신의 메모리 가드 때문에 전수 검색하지 못했다 → 금요일에 컨테이너에서 `rg -n "jeonhokim"` 로 전수 확인.

## 5. 인증, 권한, 격리

| 항목 | 방식 |
|---|---|
| 구독 인증 | 금요일 James 가 `claude setup-token` 으로 `CLAUDE_CODE_OAUTH_TOKEN`(유효 1년, 모델 요청만 가능)을 만들고 **Codespaces 사용자 비밀값**으로 등록, 접근 repo 를 `insighta-sprint` 하나로 제한. 값은 CC 가 보지 않는다 |
| API 키 | 환경에 `ANTHROPIC_API_KEY` 를 두지 않는다. 있으면 `claude -p` 는 항상 API 과금으로 바뀐다(문서). 시험 6 에서 `env` 로 확인 |
| 권한 방식(S9) | 권한 우회 플래그는 이 컨테이너 안에서만(방화벽 · 비루트 · 자격 증명 없음). 문서는 이 구성에서도 `~/.claude` 자격 증명 유출은 막지 못한다고 경고 → 토큰은 모델 요청 전용, 허용 도메인 최소화, 스프린트 후 폐기 · 재발급 |
| 만료 | 로그인이 만료되어 갱신 불가면 무인 세션이 멈춘다(문서). 스크립트가 감지해 `progress.md` 에 기록하고 멈춘다 |
| 본 repo 쓰기 | 없음(시험 5). 코드스페이스의 `customizations.codespaces.repositories` 에는 `insighta-sprint` 만 쓴다 |
| 외부 입력 | 이슈 · PR 본문 · 웹 내용은 데이터로만 취급. 설문 원문은 에이전트에게 주지 않는다(S8) |
| 정지 | ① `insighta-sprint` 에 `STOP` 파일 커밋(모바일 가능) → 스크립트가 새 세션을 시작하지 않고 진행 중 세션을 정리 ② 코드스페이스 중지 · 삭제 ③ 구독 토큰 폐기(최종) |

## 6. 스프린트 제어 스크립트 (금요일 PR, 승인 후)

`insighta-sprint/scripts/sprint/`:
- `start.sh` — 구간 시작: 유휴 타임아웃 확인, `git pull`, `STOP` 확인, 세션 시작.
- `run-loop.sh` — 세션 종료 시 재시작. 재시작 상한(시간당 N회), 백오프, 인증 만료 · 사용량 한도 오류 시 중단 + 기록.
- `heartbeat` — **터미널에 출력이 계속 나가게 한다**(James 요구). `run-loop.sh` 가 60초마다 한 줄(시각 · 실행 중 세션 수 · 마지막 커밋)을 표준 출력으로 내보내고, 세션 로그도 같은 터미널로 흘린다. 문서상 터미널 입력 · 출력이 유휴 판정에서 활동이다. 단 **클라이언트가 연결되지 않았을 때도 인정되는지는 문서에 없다** → 금요일 소크(`friday-dry-run.md` §8)가 증명한다.
- `heavy.sh` — `flock` 로 jest · tsc · playwright 를 동시 2개로 제한.
- `checkpoint.sh` — 과제 종료 시 commit · push, 구간 종료 1시간 전부터 새 과제 금지.
- `scan-diff.sh` — verifier 용 diff 검사: LLM · 외부 API 경로(`api.anthropic.com`, `@anthropic-ai/sdk`, `openrouter.ai`, `ANTHROPIC_API_KEY`, `OPENROUTER`), `.skip` · `.only`, 테스트 파일 삭제, 비밀 패턴.

## 7. 사용량 관리

- Ultra(James 요약, 미확인): Max 20x 의 새 이름, 월 $200(웹 월 결제만), 주간 한도 Pro 의 10배, 인증 계정은 5시간 한도 없음(설정 > 사용량에 "Current session" 막대가 없으면 인증), 월 API 크레딧 $200. 목요일에 막대 유무를 James 가 확인한다. 막대가 있으면 5시간 한도가 적용되어 병렬도를 줄여야 한다.
- 세션이 자기 사용량을 읽는 방법은 찾지 못했다(미검증). 대체로 시간대별 고정 병렬도: 시작은 worker 2, 한도 오류가 나면 worker 1.
- `progress.md` 에 구간별 실행 시간, 재시작 횟수, 한도 오류 횟수를 적는다.

## 8. 미검증 (금요일 시험 운전으로 확인)

코드스페이스 12시간 상한(라이브 페이지) / 머신 RAM · 디스크 / 기본 토큰의 쓰기 범위 / `NET_ADMIN` 허용 / 컨테이너 내 PostgreSQL + pgvector 설치와 `prisma db push` 동작 / 세션 출력이 유휴 타임아웃을 막는지 / Playwright(chromium) 설치와 `no-auth` 프로젝트 실행.
