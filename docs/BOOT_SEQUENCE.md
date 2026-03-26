# Session Boot Sequence

> `/init` skill이 참조하는 세션 부트 절차. CLAUDE.md에서 분리.

## Phase 1: 컨텍스트 로드 (첫 번째 응답 전에 완료)

**모든 작업 시작 전에 아래 파일들을 반드시 Read 도구로 읽어야 한다. 예외 없음.**

```
Read: memory/MEMORY.md           ← 자동 로드됨 (200줄 제한)
Read: memory/credentials.md      ← GitHub Secrets 이름, API 키 위치, 시크릿→env 매핑
Read: memory/troubleshooting.md  ← 과거 실수 패턴, 반복 방지 체크리스트
```

## Phase 2: 작업 도메인별 추가 로드

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

## 위반 시 행동

- 시크릿 이름, API 키, 환경변수를 **추측하거나 임의로 만들면 안 된다**
- credentials.md에 없는 시크릿 이름을 workflow/코드에 사용하면 안 된다
- 확신이 없으면 credentials.md를 다시 읽고 확인한다
