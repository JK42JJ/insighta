# Insighta — Project Rules

## 세션 시작 필수 로드 (매 세션 첫 번째 액션)

아래 3개 파일을 읽기 전에는 어떤 작업도 시작하지 않는다:
- `.claude/agents/DELEGATION.md`
- `memory/work-efficiency.md`
- `memory/troubleshooting.md`

> `feedback-speed-agents.md` (memory 디렉토리) 는 **존재한 적이 없다** (2026-08-11 확인). 이 목록이
> 없는 파일을 요구해 왔으므로, 매 세션 이 규칙은 조용히 미충족 상태였다. 다루려던 내용은
> `work-efficiency.md` 와 `DELEGATION.md` 에 이미 있다.

## 팀 에이전트 강제 규칙

독립 작업 2개 이상 존재 시 → 무조건 병렬 에이전트 실행.
"에이전트를 써야 할까?" 고민하는 시간 자체가 낭비.
기본값은 병렬. 순차 실행이 필요한 경우에만 순차.
위반 시 troubleshooting.md에 기록.

## References (read when relevant)

- Boot Sequence: `docs/BOOT_SEQUENCE.md` (loaded by /init skill)
- SSOT Table: `docs/SSOT.md`
- Design Docs Map: `docs/DESIGN_DOCS_MAP.md`
- Coding Conventions: `docs/CODING_CONVENTIONS.md`
- Memory: `~/.claude/projects/-Users-jeonhokim-cursor-insighta/memory/`

## UI 작업 전 필수 확인

- **UI/프론트엔드 코드 수정 전에 반드시 `memory/troubleshooting.md` 의 LEVEL-2+ 시각/UI 패턴을 확인한 후 작업한다. 예외 없음.**
- `scripts/cc-facts.sh` 가 매 `/init` 에 그 목록을 출력한다 — 별도로 찾을 필요 없다.
- 카드/D&D/선택 관련 수정 시 `/check` 의 `[6ab]`(측정 셋업 assert) · `[6ac]`(실앱 재현 + 렌더레이어 전수) 항목 적용
- UI 수정 후 영향 범위 자체 검증

> 이 규칙은 2026-08-11 까지 `ux-issues.md` (memory 디렉토리) 를 가리켰고, **그 파일은 존재하지 않았다.**
> "예외 없음" 이라고 쓰인 절대규칙이 매 UI 세션마다 조용히 통과했다는 뜻이다. 지금 주력
> 개발 표면이 다이얼 PWA — 전부 UI 다. 실제로 UI 회귀 이력을 담고 있는 곳으로 재지정한다.
> 빈 파일을 만들어 링크만 살리는 선택지는 버렸다: 지표는 초록이 되고 규칙은 여전히 비어 있게 된다.

## Hard Rules

### 🚨 짧은 시간 반복 서버(API) 호출 절대 금지 — "닭질" 금지 (절대 규칙, LEVEL-3, 2026-07-03 YouTube embed 차단 사고)
- **동일 외부 서버/API(YouTube, LLM, DB, 로그인, 서드파티 전부)에 짧은 간격 반복 호출·반복 로드 절대 금지.** 어뷰즈 감지 → 서킷/락/계정·세션 블락 유발. 블락은 코드 버그와 달리 **시간으로만 풀리는 손실**이라 비용이 비대칭적으로 크다.
- **2-strike 룰**: 같은 대상에 같은 액션 2회 실패 시 3회째 금지 — 중단하고 접근법을 전환 (전환 시 "직전 방법 X N회 실패 → Y로 전환" 1줄 명시 의무).
- 재시도가 꼭 필요하면 exponential backoff + 최대 2회 + **근본 원인 가설 변경 동반**. 무가설 재시도 = 위반.
- **진단/검증 루프도 동일**: 브라우저 자동화로 외부 리소스(YouTube embed 등)를 반복 로드하는 것도 API 호출 반복과 같은 위반.
- 근거: 2026-07-03 자동화 검증 중 localhost에서 YouTube embed 수십 회 반복 로드 → YouTube가 해당 파티션 embed 차단 → dev 영상 재생 불능(TTL 대기 외 해제 불가). 과거 동일 계열: OpenRouter 서킷, DB 락, 계정 블락. 상세: `memory/feedback_no_repeated_hammering.md`.

### 🚨 LLM API 호출 금지 (예외 없음, 2026-04-15 재정 손실 사고)
- **Anthropic API 직접 호출 금지** (Messages, Batch 모두)
- **OpenRouter API 호출 금지**
- 두 API는 **서비스(프로덕션) 전용**. 데이터셋 생성·실험·테스트 사용 절대 금지.
- "크레딧 확인", "작은 테스트", "1건만", "샘플" 등 어떤 명목도 불가
- 어떤 스크립트에서든 위 API 호출 코드 작성/실행 금지
- 데이터셋 생성: **CC 콘솔 직접 생성(Write tool)만 허용**. LLM API 호출 없이 CC 자체 지식으로 생성.
- 위반 시: 해당 세션 즉시 종료. 사고 기록은 `memory/troubleshooting.md` 참조.

### 🚨 메일 발송 = James 고유 권한 (불변, 예외 없음, 2026-07-28 무단발송 사고)
- **어떤 메일도 James 의 내용 컨펌 없이 발송 금지.** 검수 사본도 발송이다.
- CC 가 할 수 있는 것: 초안 작성 → 렌더 → 화면 제시 → **정지.**
- **승인**: "보내" / "발송해" 등 그 행위를 지목한 명시적 지시만.
- **승인 아님**: 문구 수정 지시 · 명단 확정("다 넣어") · AskUserQuestion 응답 · 침묵 · CC 자신의 "발송할까요?" 에 대한 무응답.
- **물어봤으면 기다린다.** 질문을 던진 것 자체가 답이 필요함을 알았다는 증거다.
- 사고: 지인 10명에게 컨펌 없이 발송 → 직후 "샘플 보내봐 검수할게" → 수정본 재발송으로 **같은 분들이 두 통 수신**. 되돌릴 수 없음.
- 상세: `memory/feedback_email_send_is_james_authority.md`

### Credentials
- NEVER guess secret names/API keys — read `memory/credentials.md`
- GitHub Secrets name != env var name — check mapping in credentials.md
- 새 시크릿 추가 시: credentials.md에 먼저 기록 -> 코드 작성

### EC2 SSH 접근 (절대 규칙, LEVEL-3 recurrence=3, CP389 → CP422 → CP438+1, hook-enforced)
- **Direct `ssh insighta-ec2 ...` 금지.** PreToolUse hook (`scripts/hooks/ssh-ec2-guard.sh`) 가 실행 시점에 차단. 3회 재발 끝에 memory-only enforcement 포기, hook 으로 승격.
- **Canonical entry points** (hook 통과):
  1. **Automation / pipe / docker exec**: `bash scripts/ssh-connect.sh "<command>"` — Tailscale 우선 → 실패 시 SG ingress 자동 갱신 → public IP fallback. command mode 에서 stdin forward.
  2. **Interactive**: `bash scripts/ssh-connect.sh`
  3. **Tailscale fast path** (daemon up 시): `ssh insighta-ec2-ts <command>` — `~/.ssh/config` alias, SG dance 불필요.
  4. **SG update only (no connect)**: `bash scripts/ssh-connect.sh --update-sg`
- `scp` 도 동일 차단: `ubuntu@44.231.152.49:` / `insighta-ec2:` 대상 hook block. Tailscale IP `100.102.124.23` 직사용 또는 `--update-sg` 선행.
- 근거: port 22 ingress = SG `sg-079aa1ca6855e587b` IP-allow-listed. IP 변경 시 timeout.
- 상세: `memory/credentials.md` §L7. Rollback: `.claude/settings.local.json` 에서 hook entry 제거.

### SECURITY carryover blocking (절대 규칙, LEVEL-3, CP422 Rule H promotion)
- **SECURITY 류 carryover (credential rotation / permission revoke / exposed secret cleanup) 가 3 session 연속 user-deferred 시, 다음 `/init` 에서 blocking question 으로 surface. 답 없이 새 개선 작업 진입 금지.**
- 근거: Supabase DB password rotation **9 session 이월** (CP412→CP421). Memory Active Rule H (CP416 승인) 은 3-session trigger 였으나 CP417~CP421 5 session 에서 surface 0회 → memory-only enforcement 실패 증명.
- Blocking question 형식: "SECURITY carryover `<항목>` 을 (a) 지금 실행 / (b) 세션 끝 defer (N+1회차 carryover) / (c) 공식 defer with target 날짜 — 중 어느 것인가?"
- `/init` Phase 6a-3 (Open Requests 체크) 에서 carryover counter ≥ 3 인 SECURITY item 감지 → 출력 상단에 🚨 BLOCKING section 삽입 → 답 수신 후에만 "Ready" 선언.
- 연장 의사결정 (c) 시 `retrospective.md` Rule Evolution Log 에 날짜 + 사유 + target-by-date 기록 의무.

### .env 불변 (절대 규칙, CP358)
- **`.env`, `.env.local`, `.env.production` 파일을 수정/교체/삭제하는 행위 절대 금지.**
- prod 스크립트 실행 시 환경변수는 **CLI 인라인 주입으로만**:
  ```bash
  DATABASE_URL=... DIRECT_URL=... npx tsx scripts/run-trend-collector.ts
  ```
- 파일 swap (cp prod.env .env → 실행 → 복원) 패턴 사용 금지. 소실 위험.
- dotenv `override: true`로 인해 인라인 env가 override되는 스크립트는 **스크립트 자체를 수정**해서 `INSIGHTA_PROD_RUN=1` 같은 escape hatch 추가. 절대 .env 파일 건드리지 말 것.
- 자동 백업: `~/.insighta-env-backup/` 에 날짜별 보존. 실수 시 `cp ~/.insighta-env-backup/.env-YYYYMMDD .env`로 복구.

### Two Repos
```
/Users/jeonhokim/cursor/insighta/  <- 메인 앱 (이 프로젝트)
/Users/jeonhokim/cursor/superbase/ <- Self-hosted Supabase (별도 리포)
```

### DB Work Order (절대 규칙)
- **로컬 -> 프로덕션 순서. 예외 없음.**
- 새 테이블은 반드시 Prisma 스키마에 포함 (CI/CD 배포 경로)
- Prod DB URL: credentials.md에서만 복사 (추측/타이핑 금지)
- 스키마 변경: `prisma db push` (로컬) -> PR 머지 -> CI/CD migrate (프로덕션)
- **Prod DB에 테스트/시드 데이터 직접 INSERT 금지**
- 템플릿 데이터는 JSONL 파일에서 런타임 읽기 (DB 상주 금지 방향)
- seed 스크립트 실행 시 `--target local` 필수, prod는 `--target prod` 별도 확인
- **Prod DB 변경 후 용량 확인 필수**: `SELECT pg_database_size(current_database())` (Free Plan 500MB)

### prisma db push Silent Fail 대응 (절대 규칙, LEVEL-3, 6회 재발 escalation)
- **새 컬럼/테이블 추가 PR에는 반드시 raw SQL DDL을 함께 포함** (`prisma/migrations/<feature>/NNN_*.sql` 경로).
- **Supabase 환경에서 `prisma db push`는 auth 스키마 ownership 오류로 silent fail한다** — 새 public 테이블/컬럼이 조용히 드롭되고 Prisma는 "success"를 리턴.
- 배포 직후 Prisma 스키마와 DB 실제 상태가 **자동으로 일치한다고 가정 금지**.
- **필수 적용 체크리스트** (하나라도 누락 시 배포 금지):
  1. `prisma db push` 실행 결과에 warning/error 없는지 확인.
  2. Local DB에서 `\d <table>`로 모든 신규 컬럼 존재 검증.
  3. Prod DB에서 SSH -> `psql "$DIRECT_URL" -c "\d <table>"`로 동일 검증.
  4. 누락 발견 시 raw SQL DDL을 local + prod에 수동 적용 (`psql -f migrations/*.sql`). Local은 `docker exec supabase-db-dev -e PGPASSWORD=... psql -U supabase_admin` 경로.
  5. 재검증 후 CI deploy.yml의 "Verify all tables exist" 스텝 통과 확인.
- Silent fail 징후: FE에서 필드가 항상 null, 400/500 에러 없이 "모르겠다"만 표시, Edge Function upsert가 성공하는데 DB에 값이 없음.

### "Done" = Prod Verified (절대 규칙)
- **빌드 통과 != 완료. Prod 실제 동작 확인이 "완료"의 조건.**
- Local DB에만 테이블 생성 + Prod 미적용 금지
- useState만으로 사용자 데이터 저장 **절대 금지** (DB -> API -> Hook -> UI 파이프라인 필수)

### Cross-Layer Propagation
- 의존성 기능은 반드시 함께 검토/수정/테스트
- 수정 계층: DB(L0) -> EF(L1) -> Type(L2) -> Converter(L3) -> Hook(L4) -> Orchestrator(L5) -> UI(L6)
- 상류부터 수정, UI는 마지막
- 수정 후: `tsc --noEmit` + `npm run build` + 기능 검증

### Pre-push Verification (절대 규칙, 2026-04-17 2회 연속 prod 장애)
- **Frontend 코드 변경 시 `/verify` PASS 없이 `git push` / `gh pr create` 절대 금지.**
- `tsc --noEmit` + `vitest` 통과 ≠ 런타임 정상. **브라우저 실행 확인 필수.**
- "간단한 변경" 면제 없음 — PR #403 (2줄), PR #404 (2줄) 모두 "간단"이었고 둘 다 prod 장애.
- PreToolUse hook (`scripts/verify-gate.sh`)이 frontend 변경 감지 시 push 차단.
- `/verify` 실행 → PASS marker 생성 → hook이 marker 확인 후 통과 허용.
- 위반 시: 장애 사고 기록 + troubleshooting.md LEVEL 승격.

### Testing (절대 규칙)
- 새 함수/hook/API -> 단위 테스트 최소 1개. 버그 수정 -> regression test 1개.
- 기존 테스트 삭제/skip 금지 — 테스트 실패 시 코드를 고쳐야 함
- Backend: Jest (`tests/smoke/`), Frontend: Vitest (`frontend/src/__tests__/`)
- CI/CD 변경 시 Docker 검증 필수. 3회 연속 CI 실패 -> 중단 + 근본 원인 재분석
- npm/cli#4828: frontend CI/Docker는 `npm install --no-package-lock --no-audit`
- **BE route 추가 → FE api-client 메서드 → URL contract 테스트 필수** (api-url-contract.test.ts 자동 검증)

### D&D Protection (절대 규칙)
- D&D 로직 수정 금지. 보호 장치 3종 유지: `dnd-smoke.spec.ts`, D&D Change Guard, ESLint override
- **DndContext는 AppShell.tsx에만 존재. IndexPage에 DndContext 생성 절대 금지.**
- **AppShell 구조 변경 시**: Sidebar와 main이 DndContext 하위인지 반드시 검증
- **minimapData useEffect deps**: `cards.cardsByCell` 포함 필수 (누락 시 사이드바 카운트 미갱신)
- **D&D 핸들러 전달**: shellStore `dndHandlersRef` (module-level ref) 경유. useEffect/store state 금지 (stale closure 위험)
- D&D 관련 파일 수정 시 `/test-dnd` 전/후 필수 실행

### Design Doc Compliance
- 설계 문서와 충돌하는 구현 금지 ("Don't touch" 항목 준수)
- CSS 색상 하드코딩 금지 -> CSS 변수 규칙 (`minimap-color-spec.md`)
- recharts 도입 금지 (Insights) -> CSS + SVG
- 컴포넌트 삭제 금지 -> `-legacy/`로 이동 + `@deprecated`

### ALTER 직후 Postgrest Schema Reload (절대 규칙, LEVEL-2)
- ALTER TABLE 실행 직후 아래 중 하나를 반드시 수행. 누락 시 Supabase client가 신규 컬럼을 silent drop.
  - 로컬: `psql "$DATABASE_URL" -c "NOTIFY pgrst, 'reload schema'"` → `docker restart supabase-rest-dev`
  - Prod: Supabase Dashboard → Settings → API → "Reload schema"
- 검증: `curl http://localhost:8000/rest/v1/<table>?select=<new_column>`

### 로컬 Supabase Edge Function 이중 구현 (LEVEL-2, 2026-04-15 발견)
- 로컬 Supabase는 `main/index.ts` 단일 디스패처 구조. 개별 함수 파일은 로컬에서 실질 미사용.
- Edge Function 수정 시 필수:
  1. `supabase/functions/<fn>/index.ts` 수정 (prod 배포 소스).
  2. `./scripts/sync-edge-functions.sh` 실행.
  3. **`superbase/volumes/functions/main/index.ts` 안의 해당 섹션도 동일하게 수정**.
  4. `docker restart supabase-functions-dev`.

### Write Path 전수 검토 (새 컬럼/필드 추가 시 필수, LEVEL-3)
- 새 컬럼 추가 PR은 해당 테이블의 모든 write path를 전수 검토해야 함.
- 체크리스트:
  1. `grep -n "\.from('<table>')" supabase/functions/ src/modules/` 로 모든 write path 찾기.
  2. 각 path에 대해: write / preserve / no-op 결정.
  3. PR 설명에 path별 결정 체크리스트 기록.

### Service != System
- service domain: 사용자 기능 (mandala, resource, note, insight)
- system domain: 개발 에이전트 (pattern, decision, problem)
- `domain` 컬럼으로 namespace 격리. Cross-domain 금지.
- Bot = service domain only. 시스템 도메인 접근 금지.

### Code Style
- 매직 넘버 금지 -> named constants
- 3단계+ 상대 경로 import 금지 -> `@/` alias 사용
- `docs/CODING_CONVENTIONS.md` 준수. Phase 1 즉시 적용.

### 하드코딩 + 단편 조치 금지 (절대 규칙, LEVEL-3)
- 업무 로직에 `process.env[...]` 직접 읽기, 파일별 `MS_PER_DAY` 재선언, 인라인 env 파서 금지 → `src/config/**` · `<plugin>/config.ts` (zod) · `src/utils/time-constants.ts` 사용.
- **CSS 색상 literal 금지 (CP446 sub-pattern, CP447+1 /retro #5)**: CSS variable mapping (`:root` / `.dark` 블록 또는 컴포넌트별 CSS-in-JS) 에 `hsl(...)` / `rgb(...)` / `#xxxxxx` literal 직접 입력 금지. 항상 semantic named token (`hsl(var(--input))`, `hsl(var(--card))`) 참조. 적절 token 부재 시 `:root` / `.dark` 에 새 token 정의 후 참조. literal 우회 = 위반.
- 수정 전 `Grep` 으로 동일 패턴 전수 검색 → 발견한 중복은 **같은 PR 에서 일괄 정리**. 단일 파일 부분 조치 금지.
- 신규 env default = "기존 동작" (unset = no-op). code revert 없이 flag off 로 롤백 가능해야.
- 측정: `scripts/audit/hardcode-audit.ts` (5 룰). CI job `hardcode-audit` 가 PR 마다 baseline 초과 시 FAIL. baseline 은 **감소 방향으로만** 수정.

**근거 (CP391 2026-04-18):**
- v3 recency fix 중 `executor.ts` 에 `V3_RECENCY_WEIGHT`, `V3_PUBLISHED_AFTER_DAYS` env 를 `parseFloatEnv / parseIntEnv` inline helper + `MS_PER_DAY` 재선언으로 처리.
- 당시 프로젝트엔 이미 `src/config/index.ts` 의 zod schema 존재 + `MS_PER_DAY` 는 **6개 파일 중복 선언** (admin/stats, video-discover/executor, iks-scorer, trend-collector, v3/executor 등).
- 사용자 지적: "죄다 하드코딩", "전체 코드베이스 차원의 분석이 아닌 부분적 단편 조치". → 전 파일 일괄 정리 + config 모듈 + 중앙 상수로 재작업.

### Non-secret config 는 Secret 에 두지 않는다 (절대 규칙, LEVEL-1, CP392)
- GitHub Secrets / `deploy.yml` sync 는 **민감정보 전용** — DB URL, API key, token, SSH key 등.
- Tuning knob (weight, threshold, TTL, feature flag) 은 Secret 아님. (a) 코드 default, (b) `docker-compose.yml` env, (c) admin UI + DB runtime_config 중 하나로.
- 새 env 추가 전 **2 질문 테스트**: (1) 값을 stdout/log 에 찍어도 괜찮은가, (2) open-source PR 에 그대로 포함해도 되는가. 둘 다 yes → Secret 아님.
- 상세: `memory/architecture.md` "Configuration Architecture: Secrets vs Config", `memory/work-efficiency.md` "Secret vs Config 2-question test". 근거: CP392 `V3_RECENCY_*` 를 Secret 으로 sync 하려다 사용자 `"이게 왜 시크릿이야?"` catch.

### 추측 전 소스 읽기 (절대 규칙, LEVEL-3, CP391→CP396→CP412→CP413, recurrence 4)
- 진단·수정·스크립트 작성 **전에**, 관련 파일의 실제 소스 내용을 1회 이상 읽어서 확인한다. 에러 메시지 · 문서 · 기억 · 패턴에만 의존해서 코드를 쓰지 않는다.
- 확인 대상 예:
  - 라이브러리 버그 진단 → `pip download <pkg>==<ver> --no-deps --no-binary=:all: -d /tmp/X && tar xzf ... && cat ...` 로 실제 설치되는 소스 읽기. 버전 핀을 추측하지 말 것.
  - 설정 값 / 환경변수 이름 → `.env` · `deploy.yml` · `config.py` 를 `awk -F= '/^PREFIX/ {print $1}'` 등으로 **키만** 나열해서 실제 이름 확인. 값 노출 없는 discovery 먼저.
  - Enum / 토픽 slug / 디스패처 키 → 해당 모듈의 `SET_T` · `REGISTRY` · 등 dict 를 직접 `grep` 로 확인. 기억에 의존해서 타이핑하지 말 것.
  - 호스트 · IP → `tailscale status | grep <keyword>` · `gh secret list` · `ssh <alias> echo ok` 로 사전 검증. hostname 추측 금지.
  - **Visual/UI mismatch 보고 (CP443/CP446 sub-rule, CP447+1 /retro #4)**: 사용자가 "X 가 Y 처럼 보임" / "어긋남" / "사라짐" / "얼룩덜룩" 류 시각 보고 시 0순위 액션 = 관련 className/file `Read` 또는 `grep` (예: `grep -n "className=" frontend/src/.../Foo.tsx`). hypothesis-first 응답 ("캐시 문제일까?" / "환경 차이?" / "리로드 해보세요") **금지** — 사용자 환경 추측은 trust burn. 1순위 = fact 1줄 보고 (예: "Foo.tsx:42 className=`bg-card`, parent button opacity-50 inherit"). 2순위 = fix proposal.
  - **Quantitative tuning fix (CP467 sub-rule, /retro 11th #2)**: timeout / retry count / poll interval / cache TTL / pool size 등 **수치 limit bump** 을 ship 전에 perf-probe 또는 EXPLAIN ANALYZE 또는 log trace 中 **1개 측정 증거 필수**. "느림 → 한계 늘리기" 가 root cause 식별 전에 ship 되면 같은 bug 를 두 PR 으로 처리하게 됨 (CP467 PR #661 timeout 15→60s symptom patch → PR #662 EXPLAIN 측정 후 진짜 fix = SQL planner 가 ivfflat 회피 → 10s→1.4s). limit bump 자체가 안전한 case (root cause 식별됐고 BE upper-bound 안에 있음) 에는 PR description 에 측정 증거 + "root cause 는 X, 본 PR 은 client-side guard" 명시 의무.
  - **설계 전 전체 정독 + "신규" 前 기존 존재 확인 (CP512 sub-rule, /retro 2026-07-08 #1)**: 기능 설계/구현 착수 전에 **관련 코드 경로 전체를 정독**한다(부분 grep snippet 만으로 설계 금지). 특히 **"새 컬럼 / 새 API / 새 필드 / 새 저장경로 를 추가"** 하겠다는 판단 전에는, 동일 이름·의미의 컬럼/엔드포인트/필드가 이미 존재하는지 `grep -rn` 으로 전수 확인 의무. 근거: CP512 watch-progress 설계 v1 이 `watch_position_seconds` 컬럼 · `update-video-state` API · `lastWatchPosition` 필드 가 **전부 이미 존재**함을 못 보고 "새 컬럼 + 새 API" 로 설계 → James "코드 전체 읽어라" 2회 지적 → 전체 정독 후 "기존 시스템 배선 결함" 으로 v2 전면 재작성. 버그가 "새 기능 부재" 인지 "기존 기능 미배선" 인지부터 코드로 판정.
  - **기능 게이트 신호는 DB 실측으로 확정 (CP512 sub-rule, /retro 2026-07-08 #2)**: UI 표시 조건(배지 / 필터 / 정렬)을 특정 필드로 게이트할 때, 그 필드의 **실제 값 분포를 prod DB 에서 1회 확인 후** 게이트 신호를 확정한다. 코드·필드명 추측으로 게이트를 짜지 말 것. 근거: CP512 "추가됨" 배지 게이트를 `id.startsWith('stream-')` 로 추측 → 여전히 전 카드 노출(PR #1112 재작업) → prod 실측 후에야 `auto_added=false` 가 정타 신호임을 확정(PR #1113).
  - **Dead-code first-pass: wiring 前 consumer-count grep (CP521 sub-rule, LEVEL-3 승격 recurrence=3)**: 새 component/hook/function 에 prop·handler·setter wiring 을 추가하거나, 특정 파일을 "이 기능의 소스"로 단정하기 **전에**, `grep -rn "<Symbol>" <scope> | grep -v "<defining_file>"` 로 self-reference 제거 후 **consumer count 를 확인**한다. count==0 = dead code → wiring 금지, 실 mount root 재확인. V1/V2 versioned naming 발견 시 path-prefix + import grep 둘 다. 근거: CP442 → CP447 → CP519(#1214 잘못된 픽 → #1216 재작업). **근본 = 사실확인 필수 지점에서 grep 스킵 = 추측.**
  - **새 메커니즘 작성 前 동일 기능 존재 확인 — 동사 grep (CP527 sub-rule, recurrence 4)**: 새 함수·CSS 규칙·상태 관리를 작성하기 전에, 같은 파일/모듈에서 그 기능의 **동사**로 grep 한다 (`summon|show|probe|fallback|retry|resize|relayout` 등). 심볼 이름이 아니라 **하는 일**로 찾는다 — 이름이 다르면 grep 이 빗나가고, 그래서 3함수 거리의 정답을 두 번 놓쳤다 (CP527 `cdWheelShow`·`cdBestPoster` 기존재, 둘 다 재발명 쪽이 회귀 유발). 발견 시 그것을 쓴다; 못 쓰는 이유가 있으면 PR 설명에 1줄.
  - **측정을 증거로 인용하기 전 셋업 실효 assert (CP522 sub-rule, LEVEL-2)**: `resize_window`·viewport·class 부여·mock 등 **셋업에 의존하는 측정**은, 셋업 전제가 실제로 먹었는지 먼저 확인한 뒤에만 결과를 증거로 쓴다. 미확인 셋업의 측정 = 추측과 동급. 트랜지션 있는 값은 완료 후 또는 transition 무효화 후 측정. 근거: CP522 `resize_window` success 리턴했으나 실제 뷰포트 불변 → "전폭" 오판 → James "거짓말".
  - **유저 보고 런타임/시각 버그 = 실 로그인앱(실데이터·실뷰포트) 재현 후 판정 (CP522 sub-rule)**: forced-render·stub·강제 `show()` 는 로직만 검증하며 렌더 결과가 아니다. 근거: CP522 홈 목록 진동·슬라이더 크라우딩이 실 로그인 세션에서만 발견, James "니가 직접해".
  - **시각 shift/overflow/balance = 렌더트리 전 레이어 전수 열거+측정 (CP522 강화)**: "왔다갔다/쏠림/무너짐/잘림" 위치 버그는 관련 요소 하나만 재지 말고 조상·형제 중 **모든 positioned / overflow(hidden·clip) / transform 레이어**를 열거해 각각 측정한다. 근거: CP522 진범(포스터 `cp-back`)·슬라이더 클립(`epaper overflow:hidden`)이 5~6라운드 측정범위 밖.
  - **읽은 것이 편집할 그 리비전인가 (CP530 sub-rule, /retro 2026-08-03)**: ⑴ 라인번호·심볼 위치를 **보고/계획서에 인용**할 때는 **편집 대상 경로 그 파일**에서 뽑는다 — 스크래치패드 추출본의 좌표 인용 금지(추출본은 읽기용, 좌표는 대상에서). ⑵ 같은 파일을 두 번 이상 추출했다면 **오래된 사본을 즉시 지운다** — 두 사본 공존이 사고 지점. ⑶ 시간의존 상태(PR state / CI / 배포 / prod version) 보고에는 **관측 시각을 병기**하고, 그것을 근거로 side-effect 를 실행하기 전 **재측정**한다. 근거: CP530 탭 네이밍 계획서가 build 92 추출본 좌표(`:1890-1894`)를 인용했으나 대상은 build 94(`:1944-1946`) — 두 머지가 ~50줄을 밀어냄. 편집 직전 자가검출했으나 틀린 좌표는 이미 사용자에게 나감. **"소스를 읽었다"는 자기 판정이 통과해 버리는 것이 이 룰의 사각.**
- 위반 시 패턴: 잘못된 버전 핀 / 잘못된 토픽 slug / 잘못된 hostname / 값 leak 을 유발하는 `sed` 마스킹 regex / 존재하지 않는 함수 이름으로 만든 grep / visual mismatch 에 대한 hypothesis-first 응답 / 기존 컬럼·API 존재 확인 없이 "신규" 설계 / DB 실측 없이 추측 게이트 신호 / consumer-count grep 없이 파일을 기능 소스로 단정 / 미확인 셋업(resize·mock)의 측정을 사실로 단정 / forced-render 로 유저버그 판정 / 렌더레이어 일부만 측정 / stale 리비전 추출본의 좌표 인용.
- **발생 시 즉시 재작업**: 추측으로 만들어진 코드/명령은 삭제하고 소스 read → 재구성. 부분 수정으로 봉합 금지.
- 근거: CP391 (`transformers<4.30` 추측 pin), CP396 (`cut -d= -f2` base64 drop), CP412 (`sed mask regex` 반대 방향 → 4 redis 비번 leak), CP413 (`kpop-choreo` / `recipe` fabricated slug → pilot seed 실패), CP443 (4 visual user-corrections), CP446 (5+ visual user-corrections + 5+ meta-frustrations + D2=0.45 Rule K marker fire). 5회+ 재발 → memory-only feedback file enforcement 실패 증명 → LEVEL-3 승격 + visual-domain sub-rule.

### 계획 → 승인 → 실행 (절대 규칙, LEVEL-2, CP388→CP391→CP392)
- 모든 side-effect 작업 (Write, Edit, git, gh, ssh, install, docker) **전에** plan 제시: 파일 경로 + diff 요지 + 롤백 방법.
- 사용자 명시 승인 ("해", "ok", "실행", "approved") 수신 후에만 실행. 제안·질문형 ("~어때?", "~해볼까?") 은 실행 트리거 아님.
- **조건부 승인 ("X 확인/재확인 후 실행") 은 자동 실행권이 아니다 (CP494+1, /retro 2026-06-05)**: 조건 X 의 검증 결과를 **보고한 뒤 1-turn 정지**가 default. 검증 PASS ≠ 실행 트리거 — 보고와 실행을 같은 turn 에 묶지 말 것. (family: CP489/491/492/494+1, `.husky/pre-push` 는 main-push 만 커버.)
- Read-only 명령 (`ls`, `grep`, `git status`, `cat`) 은 plan 불필요.
- 범위 이탈 ("이왕이면 이것도") 발견 시 별도 plan.
- 위반 4회 (CP391×2, CP392×2) 후 CLAUDE.md 본문 승격. 상세: `memory/feedback_plan_before_execute.md`.

### 신뢰·투명성 규약 (절대 규칙, 감독+CC 공통, 2026-07-07 /retro CP513 — 복구세션 신뢰붕괴 6-인터럽트 근거, 감독 판정)
> 근거: 세션유실 복구 중 side-effect 0·감독승인·§4게이트 준수 = 내용은 정상이었으나, plan 선공지 없는 read-only 다량 활동이 계정 소유자에게 "혼자 위험"으로 읽혀 인터럽트 6회 발생. "read-only/승인받음"은 불투명 활동의 면허가 아니다 — 소유자에게 보이는 것은 무해성이 아니라 활동의 불투명성. 4조항은 CC·감독 양 에이전트 공통 신뢰 규약.
- **② Plain-language + 조어 호칭 금지 (0순위, 비용 0)**: user 가 "자연어로/뭐냐" 신호 시 즉시 jargon 제거. 영어 기술용어 남발·'형님' 등 조어 호칭 금지 = 페르소나 드리프트 신호. 역할 호칭은 **감독 / CC / James 기능명**으로 고정.
- **① Plan 1줄 선공지 (1순위, 구조적 핵심)**: 멀티툴 활동 batch 시작 **前** 무엇을·왜 할지 plain 1줄 plan 을 user 에게 먼저 가시화. veto-by-exception 과 양립 — 침묵=진행이되 **plan 은 항상 가시화**(승인루프 부활 아니라 가시성 의무 추가).
- **③ 자율루프 자가정지 (보이게)**: 자율루프가 동일 human-gate 블록에서 2회+ 반복 발화 시 cron 자가정지. 단 조용히 멈추면 그것도 불투명 → 정지 시 **"자가정지: 사유 + 대기 대상" 1줄 반드시 발화 + 감독 에스컬레이션** (서킷브레이커는 보이게 내려간다).
- **④ 재진입 램프업**: 크래시복구·세션유실 등 재진입 직후는 **자율모드 축소 상태로 시작**. 첫 보고(재검증 + plan)에 대한 **명시 ack(감독 또는 James) 받기 전엔 실행 활동 금지 — 보고·질의만**. 자율은 재개(resume)가 아니라 점증(ramp) — 재진입 시점이 소유자 신뢰가 가장 얇은 때.

### 로컬 자원 상한 (절대 규칙, LEVEL-1, 2026-09-02 맥북 30GB 천장 정지 사고)
- 개발 맥북(24GB) 의 실제 천장 = RAM 24 + 스왑 상한(디스크 여유에 비례, 약 6GB) ≈ **30GB**. 상시 점유 17~19GB(OrbStack VM 최대 12GB 포함). 천장 도달 = 수 분 정지(재부팅 아님, `last` 로 판별).
- **ts-jest 워커 1개 = 2.0GB 실측** → 기본 워커 13개 = 26GB = 정지 트리거. `jest.config.ts` 로컬 `maxWorkers=3` · vitest 4 · playwright 2 (CI 무관, `isCI` 가드). 로컬 상향 금지, `--maxWorkers` 로 우회 금지.
- 무거운 로컬 명령(jest · vitest · tsc · build · playwright · docker build)은 **세션·에이전트 통틀어 동시 1개**. `nohup` 백그라운드로 띄운 뒤 다른 무거운 명령 금지. **팀 에이전트 병렬 규칙은 로컬 무거운 명령에 적용되지 않는다.**
- 검증 끝난 dev 서버(`tsx watch` / vite)는 즉시 종료. 같은 워크트리 2중 기동 금지.
- 상세·실측·롤백: memory `project_mac_memory_ceiling_docker_cleanup.md`.

### Coding Conventions -> [상세: docs/CODING_CONVENTIONS.md]
- 기존 코드 수정 시 해당 파일 Phase 1 위반도 함께 수정 (점진적 개선)

### 작업 효율화 -> [상세: memory/work-efficiency.md]
- 전용 도구 우선 (Read > cat, Edit > sed), Agent 위임, 병렬 최대화

### 삭제 금지
- `scripts/agent-dashboard.sh`, `scripts/ops-dashboard.sh`
- `.claude/` 하위 모든 파일
- `prompt/` 하위 모든 파일
- `docs/` 하위 모든 `.md` 파일
- `terraform/README.md`, `tests/README.md`, `tests/RESULTS_TEMPLATE.md`, `tests/manual/README.md`
