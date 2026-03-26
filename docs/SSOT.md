# Canonical Sources (SSOT)

> 정보의 단일 진실 원천. 중복 방지를 위해 canonical source만 수정.

| 정보 | Canonical Source | 참조만 허용 |
|------|-----------------|------------|
| Boot Sequence | docs/BOOT_SEQUENCE.md | MEMORY.md, DELEGATION.md |
| Agent 매트릭스/위임 | .claude/agents/DELEGATION.md | MEMORY.md |
| 시크릿/키 매핑 | memory/credentials.md | - |
| 인프라 | memory/infrastructure.md | MEMORY.md |
| 두 리포 관계 | CLAUDE.md | project-structure.md |
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

## SSOT 규칙

- Canonical Source만 수정. 다른 파일은 `-> [상세: path]`로 참조만.
- 새 정보 추가 시 이 표에서 canonical source 먼저 확인.
- 중복 발견 시: canonical source로 통합 -> 나머지는 참조로 변환.
