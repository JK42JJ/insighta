# Insighta — Project Rules

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

### Credentials
- NEVER guess secret names/API keys — read `memory/credentials.md`
- GitHub Secrets name != env var name — check mapping in credentials.md
- 새 시크릿 추가 시: credentials.md에 먼저 기록 -> 코드 작성

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

### "Done" = Prod Verified (절대 규칙)
- **빌드 통과 != 완료. Prod 실제 동작 확인이 "완료"의 조건.**
- Local DB에만 테이블 생성 + Prod 미적용 금지
- useState만으로 사용자 데이터 저장 **절대 금지** (DB -> API -> Hook -> UI 파이프라인 필수)

### Cross-Layer Propagation
- 의존성 기능은 반드시 함께 검토/수정/테스트
- 수정 계층: DB(L0) -> EF(L1) -> Type(L2) -> Converter(L3) -> Hook(L4) -> Orchestrator(L5) -> UI(L6)
- 상류부터 수정, UI는 마지막
- 수정 후: `tsc --noEmit` + `npm run build` + 기능 검증

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

### Service != System
- service domain: 사용자 기능 (mandala, resource, note, insight)
- system domain: 개발 에이전트 (pattern, decision, problem)
- `domain` 컬럼으로 namespace 격리. Cross-domain 금지.
- Bot = service domain only. 시스템 도메인 접근 금지.

### Code Style
- 매직 넘버 금지 -> named constants
- 3단계+ 상대 경로 import 금지 -> `@/` alias 사용
- `docs/CODING_CONVENTIONS.md` 준수. Phase 1 즉시 적용.

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
