# 설계 문서 (Design Docs) — 작업 전 반드시 참조

> 모든 UI/UX/DB/AI 작업은 해당 설계 문서��� 읽고 시작해야 한다. 설계 문서와 충돌하는 구현은 금지.

## 문서 위치

```
docs/design/                          <- 설계 문서 디렉토리 (GitHub repo에 커밋)
```

## 설계 문서 맵

| 문서 | 경로 | 핵심 내용 | 작업 시 참조 조건 |
|------|------|----------|------------------|
| **DB 재설계 v1** | `docs/design/insighta-db-redesign-v1.md` | TO-BE 28 테이블 5 도메인, Label N:M, SCD2 히스토리, 마이그레이션 3단계 | DB 스키마 변경, 마이그레이션, 새 테이블 추가 시 |
| **사이드바 네비게이션 정리** | `docs/design/story-sidebar-navigation-cleanup.md` | AS-IS/TO-BE 사이드바, 미니맵 heat intensity, 아바타 드롭다운, Settings > Mandalas, Don't touch 목록 | 사이드바 UI 수정, 네비게이션 변경, 미니맵 수정 시 |
| **미니맵 색상 스펙** | `docs/design/minimap-color-spec.md` | Insighta CSS 변수 기반 색상 규칙, hsl(var(--primary)/opacity) 사용, 하드코딩 금지 | 미니맵 비주얼 수정 시 |
| **Insights 대시보드 뷰** | `docs/design/story-insights-dashboard-view.md` | 5번째 뷰 탭, recharts 미사용, CSS bar + SVG, 행동 유도형 디자인 | 통계/대시보드 UI 작업 시 |
| **AI Insight Layer 로드맵** | `docs/design/insighta-ai-insight-layer-roadmap.md` | DL 유형별 적용 매핑, PoC 3개 스펙, 4단계 로드���, 오픈소스 스택 | AI/분석 기능 구현, Python sidecar 작업 시 |
| **Knowledge Health Score** | `docs/design/insighta-knowledge-health-score-kpi.md` | KHS 5차원 (Completeness/Structure/Freshness/Diversity/Accuracy), 계산 SQL, Quick Wins, khs_snapshots 테이블 | KHS 기능, 데이터 품질 관련 작업 시 |
| **시나리오 순서도** | `docs/design/insighta-scenario-flowcharts.html` | 16개 사용자 시나리오 (Content/Temporal/Social/Labels/Character), User sees <-> System does 매핑 | 새 기능 구현 시 시나리오 확인, edge case 확인 |
| **UX 디자인 패턴 리서치** | `docs/design/UX_Design_Patterns_for_Knowledge_Management_Grids.md` | 3-layer header, label filtering, D&D 패턴, minimap 동기화, 접근성 | UX 리팩토링, 필터 UI, D&D 개선 시 |
| **비전 문서** | `docs/VISION.md` | 8단계 성장 여정, 캐릭터 시스템, 소비 시각화 철학, 소셜/구독 설계 | 새 기능 기획, 아키텍처 결정 시 |
| **Ontology 아키텍처** | `docs/ontology-architecture.md` | Knowledge Graph 스키마, shadow sync, embedding, action log | Ontology/Graph 관련 작업 시 |
| **만다라 에디터 AI UX 패턴** | `docs/design/mandala-editor-ai-ux-patterns.md` | 20+ AI 도구 분석, 5대 설계 결정 (2-phase gen, tab+minimap, compound undo, partial regen, template+AI) | 만다라 에디터 재설계, AI 생성 기능 구현 시 |

## 시각 참조 자료

| 자료 | 경로 | 용도 |
|------|------|------|
| 사이드바 재설계 비주얼 | `docs/design/insighta-sidebar-redesign-visual.html` | 사이드바 story의 시각 참조 (브라우저에서 열기) |
| 미니맵 heat intensity mockup | `docs/design/insighta-minimap-heat-intensity.html` | 미니맵 디자인 참조 (# 토글 포함) |
| Insights 뷰 재설계 mockup | `docs/design/insighta-insights-view-redesign.html` | Insights 뷰 레이아웃 + 색상 참조 |
| 만다라 에디터 v3 mockup | `docs/design/insighta-mandala-editor-v3.html` | AI 만다라 에디터 UX 시각 참조 |
