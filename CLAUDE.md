# Insighta — Project Rules

## 세션 시작 필수 로드 (매 세션 첫 번째 액션)

아래 4개 파일을 읽기 전에는 어떤 작업도 시작하지 않는다:
- `.claude/agents/DELEGATION.md`
- `memory/work-efficiency.md`
- `memory/feedback-speed-agents.md`
- `memory/troubleshooting.md`

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

- **UI/프론트엔드 코드 수정 전에 반드시 `memory/ux-issues.md`를 읽고 기존 이슈 및 regression 체크리스트를 확인한 후 작업한다. 예외 없음.**
- 카드/D&D/선택 관련 수정 시 ux-issues.md의 Regression Pattern Warning 체크리스트 6항목 확인
- UI 수정 후 체크리스트 기반 영향 범위 자체 검증

## Hard Rules

### 🚨 LLM API 호출 금지 (예외 없음, 2026-04-15 재정 손실 사고)
- **Anthropic API 직접 호출 금지** (Messages, Batch 모두)
- **OpenRouter API 호출 금지**
- 두 API는 **서비스(프로덕션) 전용**. 데이터셋 생성·실험·테스트 사용 절대 금지.
- "크레딧 확인", "작은 테스트", "1건만", "샘플" 등 어떤 명목도 불가
- 어떤 스크립트에서든 위 API 호출 코드 작성/실행 금지
- 데이터셋 생성: **CC 콘솔 직접 생성(Write tool)만 허용**. LLM API 호출 없이 CC 자체 지식으로 생성.
- 위반 시: 해당 세션 즉시 종료. 사고 기록은 `memory/troubleshooting.md` 참조.

### Credentials
- NEVER guess secret names/API keys — read `memory/credentials.md`
- GitHub Secrets name != env var name — check mapping in credentials.md
- 새 시크릿 추가 시: credentials.md에 먼저 기록 -> 코드 작성

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
- 수정 전 `Grep` 으로 동일 패턴 전수 검색 → 발견한 중복은 **같은 PR 에서 일괄 정리**. 단일 파일 부분 조치 금지.
- 신규 env default = "기존 동작" (unset = no-op). code revert 없이 flag off 로 롤백 가능해야.
- 측정: `scripts/audit/hardcode-audit.ts` (5 룰). CI job `hardcode-audit` 가 PR 마다 baseline 초과 시 FAIL. baseline 은 **감소 방향으로만** 수정.

**근거 (CP391 2026-04-18):**
- v3 recency fix 중 `executor.ts` 에 `V3_RECENCY_WEIGHT`, `V3_PUBLISHED_AFTER_DAYS` env 를 `parseFloatEnv / parseIntEnv` inline helper + `MS_PER_DAY` 재선언으로 처리.
- 당시 프로젝트엔 이미 `src/config/index.ts` 의 zod schema 존재 + `MS_PER_DAY` 는 **6개 파일 중복 선언** (admin/stats, video-discover/executor, iks-scorer, trend-collector, v3/executor 등).
- 사용자 지적: "죄다 하드코딩", "전체 코드베이스 차원의 분석이 아닌 부분적 단편 조치". → 전 파일 일괄 정리 + config 모듈 + 중앙 상수로 재작업.

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
