# Insighta — Claude Code Project Rules

## Session Boot Sequence (매 세션 필수 실행)

**모든 작업 시작 전에 아래 파일들을 반드시 Read 도구로 읽어야 한다. 예외 없음.**

### Phase 1: 컨텍스트 로드 (첫 번째 응답 전에 완료)
```
Read: memory/MEMORY.md           ← 자동 로드됨 (200줄 제한)
Read: memory/credentials.md      ← GitHub Secrets 이름, API 키 위치, 시크릿→env 매핑
Read: memory/troubleshooting.md  ← 과거 실수 패턴, 반복 방지 체크리스트
```

### Phase 2: 작업 도메인별 추가 로드
| 작업 유형 | 추가로 읽을 파일 |
|-----------|-----------------|
| CI/CD, workflow, 배포 | `memory/infrastructure.md` + `docs/operations-manual.md` |
| Supabase, Edge Functions | `memory/infrastructure.md` + `memory/project-structure.md` |
| UI/UX 변경, 프론트엔드 코드 | `memory/project-structure.md` + `memory/ux-issues.md` + `memory/code-modification-convention.md` + `docs/design/story-sidebar-navigation-cleanup.md` + `docs/design/minimap-color-spec.md` |
| DB 스키마 변경 | `docs/design/insighta-db-redesign-v1.md` |
| AI/분석 기능 | `docs/design/insighta-ai-insight-layer-roadmap.md` + `docs/design/insighta-knowledge-health-score-kpi.md` |
| 새 기능 구현 | `docs/design/insighta-scenario-flowcharts.html` (해당 시나리오 확인) |
| 통계/대시보드 | `docs/design/story-insights-dashboard-view.md` |
| 아키텍처 변경 | `memory/architecture.md` |
| 인프라 변경 | `memory/infrastructure.md` + `docs/infra-log.md` + `docs/operations-manual.md` |
| 운영/장애/롤백 | `docs/operations-manual.md` + `memory/troubleshooting.md` |

### 위반 시 행동
- 시크릿 이름, API 키, 환경변수를 **추측하거나 임의로 만들면 안 된다**
- credentials.md에 없는 시크릿 이름을 workflow/코드에 사용하면 안 된다
- 확신이 없으면 credentials.md를 다시 읽고 확인한다

### UI 작업 전 필수 확인 (리그레션 방지)
- **UI/프론트엔드 코드 수정 전에 반드시 `memory/ux-issues.md`를 읽고 기존 이슈 및 regression 체크리스트를 확인한 후 작업한다. 예외 없음.**
- 특히 카드/D&D/선택 관련 수정 시 ux-issues.md의 Regression Pattern Warning 체크리스트 6항목을 모두 확인
- UI 수정 후에도 체크리스트 기반으로 영향 범위를 자체 검증

## Canonical Sources (SSOT)

| 정보 | Canonical Source | 참조만 허용 |
|------|-----------------|------------|
| Boot Sequence | 이 파일 (CLAUDE.md) | MEMORY.md, DELEGATION.md |
| Agent 매트릭스/위임 | .claude/agents/DELEGATION.md | MEMORY.md |
| 시크릿/키 매핑 | memory/credentials.md | - |
| 인프라 | memory/infrastructure.md | MEMORY.md |
| 두 리포 관계 | 이 파일 (CLAUDE.md) | project-structure.md |
| 작업 효율화 | memory/work-efficiency.md | MEMORY.md |
| 아키텍처 | memory/architecture.md | docs/spec/ARCHITECTURE.md |
| 운영 매뉴얼 | docs/operations-manual.md | - |
| UX 이슈 | memory/ux-issues.md | - |
| 코드 수정 계층 | memory/code-modification-convention.md | CLAUDE.md |
| 세션 데이터 | memory/session-log.md | - |
| 유저 요청 이력 | memory/request-journal.md | - |
| 회고/메트릭 | memory/retrospective.md | delegation-metrics.md |
| Quota/Rate Limit 정책 | docs/policies/quota-policy.md | MEMORY.md |
| 코딩 컨벤션 | docs/CODING_CONVENTIONS.md | CLAUDE.md, memory/feedback-*.md |
| 장기 비전 | docs/VISION.md | MEMORY.md |
| DB 재설계 | docs/design/insighta-db-redesign-v1.md | CLAUDE.md |
| 사이드바 설계 | docs/design/story-sidebar-navigation-cleanup.md | CLAUDE.md |
| AI Insight Layer | docs/design/insighta-ai-insight-layer-roadmap.md | CLAUDE.md |
| KHS KPI | docs/design/insighta-knowledge-health-score-kpi.md | CLAUDE.md |
| 시나리오 순서도 | docs/design/insighta-scenario-flowcharts.html | CLAUDE.md |
| Insights 뷰 설계 | docs/design/story-insights-dashboard-view.md | CLAUDE.md |
| 미니맵 색상 스펙 | docs/design/minimap-color-spec.md | CLAUDE.md |

### SSOT 규칙
- Canonical Source만 수정. 다른 파일은 `-> [상세: path]`로 참조만.
- 새 정보 추가 시 이 표에서 canonical source 먼저 확인.
- 중복 발견 시: canonical source로 통합 -> 나머지는 참조로 변환.

## 설계 문서 (Design Docs) — 작업 전 반드시 참조

> 모든 UI/UX/DB/AI 작업은 해당 설계 문서를 읽고 시작해야 한다. 설계 문서와 충돌하는 구현은 금지.

### 문서 위치
```
docs/design/                          <- 설계 문서 디렉토리 (GitHub repo에 커밋)
```

### 설계 문서 맵

| 문서 | 경로 | 핵심 내용 | 작업 시 참조 조건 |
|------|------|----------|------------------|
| **DB 재설계 v1** | `docs/design/insighta-db-redesign-v1.md` | TO-BE 28 테이블 5 도메인, Label N:M, SCD2 히스토리, 마이그레이션 3단계 | DB 스키마 변경, 마이그레이션, 새 테이블 추가 시 |
| **사이드바 네비게이션 정리** | `docs/design/story-sidebar-navigation-cleanup.md` | AS-IS/TO-BE 사이드바, 미니맵 heat intensity, 아바타 드롭다운, Settings > Mandalas, Don't touch 목록 | 사이드바 UI 수정, 네비게이션 변경, 미니맵 수정 시 |
| **미니맵 색상 스펙** | `docs/design/minimap-color-spec.md` | Insighta CSS 변수 기반 색상 규칙, hsl(var(--primary)/opacity) 사용, 하드코딩 금지 | 미니맵 비주얼 수정 시 |
| **Insights 대시보드 뷰** | `docs/design/story-insights-dashboard-view.md` | 5번째 뷰 탭, recharts 미사용, CSS bar + SVG, 행동 유도형 디자인, frontend-old 재활용 범위 | 통계/대시보드 UI 작업 시 |
| **AI Insight Layer 로드맵** | `docs/design/insighta-ai-insight-layer-roadmap.md` | DL 유형별 적용 매핑, PoC 3개 스펙, 4단계 로드맵, 오픈소스 스택 | AI/분석 기능 구현, Python sidecar 작업 시 |
| **Knowledge Health Score** | `docs/design/insighta-knowledge-health-score-kpi.md` | KHS 5차원 (Completeness/Structure/Freshness/Diversity/Accuracy), 계산 SQL, Quick Wins, khs_snapshots 테이블 | KHS 기능, 데이터 품질 관련 작업 시 |
| **시나리오 순서도** | `docs/design/insighta-scenario-flowcharts.html` | 16개 사용자 시나리오 (Content/Temporal/Social/Labels/Character), User sees <-> System does 매핑 | 새 기능 구현 시 시나리오 확인, edge case 확인 |
| **UX 디자인 패턴 리서치** | `docs/design/UX_Design_Patterns_for_Knowledge_Management_Grids.md` | 3-layer header, label filtering, D&D 패턴, minimap 동기화, 접근성 | UX 리팩토링, 필터 UI, D&D 개선 시 |
| **비전 문서** | `docs/VISION.md` | 8단계 성장 여정, 캐릭터 시스템, 소비 시각화 철학, 소셜/구독 설계 | 새 기능 기획, 아키텍처 결정 시 |
| **Ontology 아키텍처** | `docs/ontology-architecture.md` | Knowledge Graph 스키마, shadow sync, embedding, action log | Ontology/Graph 관련 작업 시 |

### 시각 참조 자료

| 자료 | 경로 | 용도 |
|------|------|------|
| 사이드바 재설계 비주얼 | `docs/design/insighta-sidebar-redesign-visual.html` | 사이드바 story의 시각 참조 (브라우저에서 열기) |
| 미니맵 heat intensity mockup | `docs/design/insighta-minimap-heat-intensity.html` | 미니맵 디자인 참조 (# 토글 포함) |
| Insights 뷰 재설계 mockup | `docs/design/insighta-insights-view-redesign.html` | Insights 뷰 레이아웃 + 색상 참조 |

### 절대 규칙 (설계 문서 관련)

1. **설계 문서와 충돌하는 구현 금지** — story에 "Don't touch" 항목이 있으면 해당 코드 변경 금지
2. **CSS 색상 하드코딩 금지** — 반드시 `minimap-color-spec.md`의 CSS 변수 규칙 따름
3. **D&D 로직은 절대 건드리지 않음** — story에 명시된 D&D 보존 규칙 준수. D&D 보호 장치 3종 유지: `dnd-smoke.spec.ts`(CI gate), D&D Change Guard(CI 경고), ESLint D&D override(auto-fix 방지). 이 3개를 제거하거나 무력화하는 변경 금지.
4. **recharts 도입 금지 (Insights 뷰)** — CSS + SVG로 구현
5. **기존 컴포넌트 삭제 금지** — `-legacy/`로 이동 + `@deprecated` 주석 추가

## 핵심 규칙

### Coding Conventions → [상세: docs/CODING_CONVENTIONS.md]
- 코드 작성 시 `docs/CODING_CONVENTIONS.md`를 반드시 따를 것
- Phase 1 (코드 스타일) 즉시 적용, Phase 2-4는 해당 마일스톤 시작 시 적용
- 컨벤션에 없는 패턴이 필요할 경우, 먼저 컨벤션 문서에 추가한 후 코드에 적용
- 기존 코드를 수정할 때 해당 파일의 Phase 1 위반 사항도 함께 수정 (점진적 개선)

### GitHub Secrets 매핑 규칙
- GitHub Secrets 이름 ≠ 코드 내 환경변수 이름 (workflow에서 매핑)
- 새 시크릿 추가 시: credentials.md에 먼저 기록 → 코드 작성
- 기존 시크릿 참조 시: credentials.md 확인 → 정확한 이름 사용

### 두 리포 관계
```
/Users/jeonhokim/cursor/insighta/  ← 메인 앱 (이 프로젝트)
/Users/jeonhokim/cursor/superbase/               ← Self-hosted Supabase (별도 리포)
```

### Memory 파일 경로
```
/Users/jeonhokim/.claude/projects/-Users-jeonhokim-cursor-insighta/memory/
```

### 작업 효율화 → [상세: memory/work-efficiency.md]
- 전용 도구 우선 (Read > cat, Edit > sed)
- Agent 위임 필수
- 병렬 최대화
- credentials.md 필수 참조 (규칙 #11)

### DB 작업 순서 (절대 규칙)
- **반드시 개발(로컬) → 프로덕션(Cloud) 순서로 진행. 예외 없음.**
- 로컬 DB에서 먼저 스키마 변경/데이터 확인 → 정상 동작 확인 → 프로덕션 적용
- 프로덕션 DB에 직접 `prisma db push`하기 전에 로컬에서 동일 명령 성공 여부 확인
- 프로덕션 DB URL은 credentials.md에서만 복사 (절대 추측/타이핑 금지)
- 스키마 변경 시: `prisma db push` (로컬) → PR 머지 → CI/CD migrate job (프로덕션)
- 수동 SQL 실행 시: 로컬 psql 먼저 → 확인 후 → 프로덕션 psql

### 껍데기 기능 금지 — "완료"의 조건 (절대 규칙)
- **빌드 통과(tsc + build) ≠ 완료. Prod에서 실제 동작 확인이 "완료"의 조건.**
- **Local DB에만 테이블 생성하고 Prod 미적용 금지** → 새 테이블은 반드시 Prisma 스키마에 포함 (CI/CD 자동 배포 경로)
- **기능 구현 후 Prod 검증 필수**: curl 또는 브라우저에서 Prod API 실제 호출 → 성공 확인. 검증 증거 없으면 미완료.
- **사례**: Admin Phase 2-3에서 6개 테이블이 로컬에서만 존재 → Prod Admin write 기능 전부 실패 → 유저 발견 시점까지 2주간 방치
- → [상세: memory/feedback-no-mockup-code.md]

### 의존성 연쇄 수정 규칙 (Cross-Layer Propagation)
- **의존성 관계에 있는 기능은 반드시 함께 검토/수정/테스트해야 한다. 예외 없음.**
- **사용자 데이터 기능 구현 시 DB 파이프라인 필수 (retro #24)**: DB 테이블 → API 엔드포인트 → Frontend Hook → UI 순서. useState만으로 사용자 설정/매핑 저장은 **절대 금지** (목업 코드). 3단계 확인: (1) DB 테이블 존재? (2) API 존재? (3) Hook 존재? → 모두 YES일 때만 UI 구현.
- 필드 추가/변경 시 전체 전파 경로를 추적: DB 스키마 → Edge Function → Type 정의 → Converter → Hook → Optimistic Update → API 호출 → UI 필터링
- 카드 시스템의 의존성 맵: → [상세: memory/ux-issues.md § 카드 시스템 의존성 맵]
- 만다라트/스크래치패드/카드는 독립 단위가 아님 — 프론트엔드·백엔드·DB가 하나의 기능 체인
- 수정 전: 영향받는 모든 레이어의 파일 목록 확인
- 수정 후: `tsc --noEmit` + `npm run build` + 관련 기능 전체 동작 검증

### 코드 수정 계층 규칙 (Modification Hierarchy) → [상세: docs/CODING_CONVENTIONS.md § L0-L6, memory/code-modification-convention.md]
- **"데이터 소스(상류)부터 수정하고, UI(하류)는 마지막에 수정한다."**
- 수정 계층: DB(L0) → Edge Function(L1) → Type(L2) → Converter(L3) → Hook(L4) → Orchestrator(L5) → UI(L6)
- 상위 Level에서 해결 가능하면 하위 Level 수정을 최소화
- **Twin Fix, 참조 안정성, useEffect filter-only** → [상세: docs/CODING_CONVENTIONS.md § Phase 4-2]

### 서비스 ≠ 시스템 원칙 (2026-03-18 정의, 프로젝트 수행의 중심 원칙)
- **Ontology GraphDB는 사용자를 위한 서비스 기능이다** — 설계의 출발점
- **서비스(Service)**: 사용자 지식 관리 — mandala, resource, source, insight 등 (domain='service')
- **시스템(System)**: 개발 에이전트 작업 품질 — pattern, decision, problem (domain='system')
- 같은 ontology.nodes/edges 테이블이지만 `domain` 컬럼으로 namespace 격리
- **서비스와 시스템을 섞지 않는다** — 이슈, 마일스톤, 코드 경로 모두 구분
- Temporal 서비스 용도: 사용자 성장 독려 (액티비티 미미 시 안내/조언/실행 지원)
- Temporal 시스템 용도: Dev workflow automation (부차적)
- 서비스 issues: `service-ontology` 라벨 / 시스템 issues: `system-ontology` 라벨
- **Bot 역할 한정**: 사용자 대면 봇은 서비스 도메인에서만 동작. 시스템 도메인 접근 금지. 개발 자동화(Agent, CI/CD)는 도구이며 시스템 도메인에서 동작.
- → [상세: memory/project-principle-service-system.md]

### 테스트 필수 규칙 (절대 규칙)
- **새 함수/hook/API 추가 시** → 해당 기능의 단위 테스트 최소 1개 함께 작성. 테스트 없이 "완료" 처리 금지.
- **버그 수정 시** → 해당 버그를 재현하는 regression test 1개 함께 작성. 같은 버그가 두 번 발생하면 안 됨.
- **테스트 0개 CP는 미완료** — tsc + build 통과는 50%. 테스트 통과가 나머지 50%.
- **기존 테스트 삭제/skip 처리 금지** — 테스트가 실패하면 코드를 고쳐야지 테스트를 제거하면 안 됨.
- **테스트 인프라**: Backend = Jest (`tests/smoke/`), Frontend = Vitest (`frontend/src/__tests__/`)
- **CI 게이트**: test-backend + test-frontend job이 실패하면 build/deploy 차단됨
- **CI/CD 변경 시 Docker 검증 필수** — `docker run node:20` 또는 `docker build`로 로컬 검증 후 push. CI fix 커밋이 3회 연속 실패하면 중단하고 근본 원인 재분석.
- **npm/cli#4828 주의** — macOS에서 생성한 lockfile은 Linux native binary(rollup, esbuild 등) 누락. frontend CI/Docker는 `npm install --no-package-lock --no-audit` 사용.

### 삭제 금지
- `scripts/agent-dashboard.sh`, `scripts/ops-dashboard.sh`
- `.claude/` 하위 모든 파일
- `prompt/` 하위 모든 파일
- `docs/` 하위 모든 `.md` 파일 (d475cc9에서 37개 삭제 사고 발생, 복원 완료)
- `terraform/README.md`, `tests/README.md`, `tests/RESULTS_TEMPLATE.md`, `tests/manual/README.md`
