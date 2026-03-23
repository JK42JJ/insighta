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
| UI/UX 변경, 프론트엔드 코드 | `memory/project-structure.md` + `memory/ux-issues.md` + `memory/code-modification-convention.md` |
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

### SSOT 규칙
- Canonical Source만 수정. 다른 파일은 `-> [상세: path]`로 참조만.
- 새 정보 추가 시 이 표에서 canonical source 먼저 확인.
- 중복 발견 시: canonical source로 통합 -> 나머지는 참조로 변환.

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

### 의존성 연쇄 수정 규칙 (Cross-Layer Propagation)
- **의존성 관계에 있는 기능은 반드시 함께 검토/수정/테스트해야 한다. 예외 없음.**
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

### 삭제 금지
- `scripts/agent-dashboard.sh`, `scripts/ops-dashboard.sh`
- `.claude/` 하위 모든 파일
- `prompt/` 하위 모든 파일
- `docs/` 하위 모든 `.md` 파일 (d475cc9에서 37개 삭제 사고 발생, 복원 완료)
- `terraform/README.md`, `tests/README.md`, `tests/RESULTS_TEMPLATE.md`, `tests/manual/README.md`
