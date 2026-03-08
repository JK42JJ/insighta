# GraphRAG Roadmap — Agent-Human Collaboration Intelligence

**Owner**: JK (jamesjk4242@gmail.com)
**Project**: Insighta (https://insighta.one) — GitHub: JK42JJ/insighta
**Goal**: .md flat files → Knowledge Graph → Multi-Project Meta Graph → Self-Improving Live Service
**North Star**: 서비스가 운영되면서 새로운 요구에 즉시 반응하여 스스로 개선되는 시스템.
프로젝트 "완료"는 끝이 아니라, **자율 개선 모드의 시작**.
**핵심 데이터 소스**: Daily/Weekly Retrospective — 회고 데이터가 GraphRAG의 최우선 입력이며, 모든 패턴/메트릭/정책 개선의 근거가 된다.

---

## Reference Architecture: Personal Palantir

Palantir(Foundry/AIP)가 기업용으로 구현한 것을 **개인 개발자 스케일**로 재구성한다.

### Palantir vs Personal Palantir

| Palantir (Enterprise) | Personal Palantir (이 시스템) | 대응 |
|----------------------|------------------------------|------|
| Foundry Ontology | PostgreSQL + pgvector Ontology | 현실 1:1 매핑, 엔티티/관계 DB |
| Data Integration Pipeline | .md + Git + PostHog + GitHub API | 데이터 수집 파이프라인 |
| AIP (AI Platform) | Claude Code + Agent Orchestra | AI 실행 엔진 |
| Object Explorer | GraphRAG MCP Query API | 엔티티 탐색/검색 |
| Actions | Agent Pipeline (Plan→Execute→Deploy) | 자동 실행 |
| Contour (Analytics) | v_* SQL Views + Retrospective | 분석 대시보드 |
| Workshop (Low-code) | Issue Template + Tier System | 워크플로우 정의 (부분 대응 — Workshop의 비개발자 시각적 정의 기능과는 차이 있음) |
| Marketplace | Meta Graph Pattern Library | 재사용 지식 |
| OSDK | MCP Server API (부분 대응) | 외부 연동 인터페이스 (OSDK는 범용 SDK, MCP는 Claude Code 전용) |

### 핵심 차별점: Palantir는 "분석" 중심, 이 시스템은 "실행"까지 포함

```
Palantir:    Data → Ontology → Insight → [인간이 실행]
이 시스템:   Data → Ontology → Insight → [Agent가 실행] → Deploy → Feedback → Data
                                                              └── 폐쇄 루프 ──┘
```

### Technology Stack (개인용 최적)

```
┌─ Storage ─────────────────────────────────────────┐
│  PostgreSQL (Supabase Cloud, 기존 인프라 재활용)    │
│  + pgvector extension (semantic search)            │
│  + JSONB (flexible metadata)                       │
│  + Row-Level Security (multi-project isolation)    │
└────────────────────────────────────────────────────┘
         │
┌─ Ontology Layer ──────────────────────────────────┐
│  entities table (nodes)  — typed, versioned        │
│  edges table (relations) — weighted, typed         │
│  embeddings (pgvector)   — 384d or 768d            │
│  views (aggregation)     — real-time analytics     │
└────────────────────────────────────────────────────┘
         │
┌─ Intelligence Layer ──────────────────────────────┐
│  Claude Code (MCP Server) — query, plan, execute   │
│  Agent Orchestra          — 13+ specialized agents │
│  PostHog (signals)        — user behavior, errors  │
│  GitHub API (execution)   — issues, PRs, deploys   │
└────────────────────────────────────────────────────┘
         │
┌─ Interface Layer ─────────────────────────────────┐
│  MCP Server (graph-rag)   — Claude Code native     │
│  ops-dashboard            — terminal monitoring    │
│  agent-dashboard          — agent activity         │
│  v_* SQL Views            — analytics queries      │
└────────────────────────────────────────────────────┘
```

### Why PostgreSQL + pgvector (not Neo4j)

| 관점 | PostgreSQL + pgvector | Neo4j |
|------|----------------------|-------|
| **비용** | $0 (Supabase 무료 티어) | $65/mo (AuraDB) 또는 Docker 추가 메모리 |
| **기존 인프라** | Supabase Cloud 이미 운영 중 | 별도 인프라 필요 |
| **벡터 검색** | pgvector native (cosine, L2, inner product) | 별도 플러그인 |
| **ACID** | 네이티브 | 네이티브 |
| **그래프 쿼리** | `edges` 테이블 + recursive CTE | Cypher (더 편리) |
| **확장성** | RLS로 multi-project 격리 | DB per project 필요 |
| **백업** | 기존 backup.yml 재활용 | 별도 백업 필요 |
| **학습 곡선** | SQL (이미 사용 중) | Cypher (새로 학습) |

**결론**: 현재 스케일에서는 PostgreSQL + pgvector가 **비용 0, 인프라 추가 0, 학습 비용 최소**로 최적. 그래프 탐색이 병목이 되는 시점(노드 100K+)에서 Neo4j 전환 고려.

### Supabase 기존 인프라 활용

```
현재 Supabase Cloud (rckkhhjanqgaopynhfgd):
  ├─ public schema  — Insighta app data (videos, playlists, etc.)
  ├─ auth schema    — Supabase Auth
  └─ (추가) ontology schema  — GraphRAG Knowledge Graph
                    ├─ ontology.projects
                    ├─ ontology.agents
                    ├─ ontology.files
                    ├─ ontology.edges
                    ├─ ontology.patterns
                    ├─ ontology.signals
                    └─ ...
```

별도 DB나 서비스 없이 **기존 Supabase에 `ontology` 스키마를 추가**하면 됨.
pgvector extension은 Supabase Cloud에서 이미 활성화 가능.

---

## Architecture Vision: Multi-Project Meta Graph

```
                    ┌─────────────────────────────────┐
                    │       Meta Knowledge Graph       │
                    │   (cross-project, ever-growing)  │
                    │                                  │
                    │  Patterns ─── Decisions          │
                    │     │            │               │
                    │  Conventions ── Problems         │
                    │     │            │               │
                    │  Tech Stack ── Solutions         │
                    │     │            │               │
                    │  Agent Profiles ── Metrics       │
                    └────┬──────┬──────┬──────────────┘
                         │      │      │
              ┌──────────┘      │      └──────────┐
              ▼                 ▼                  ▼
    ┌─────────────────┐ ┌─────────────┐ ┌─────────────────┐
    │ Project A Graph │ │ Project B   │ │ Project N Graph │
    │ (Insighta)      │ │ Graph       │ │ (future)        │
    │                 │ │             │ │                 │
    │ Files, Issues,  │ │ Files...    │ │ Bootstrapped    │
    │ Sessions,       │ │             │ │ from Meta Graph │
    │ Agent Memory    │ │             │ │ in minutes      │
    └─────────────────┘ └─────────────┘ └─────────────────┘
```

### Core Principle: Knowledge Compounds

```
Project 1 (Insighta):   100% manual setup,  baseline speed
Project 2:               70% bootstrapped,   1.4x faster
Project 3:               85% bootstrapped,   2x faster
Project N:               95% bootstrapped,   speed → f(cumulative_knowledge)
```

**왜 이렇게 되는가**:
- 기술 스택별 패턴이 Meta Graph에 축적 (React + Tailwind + Supabase = 검증된 패턴 셋)
- Agent 위임 정책이 프로젝트마다 최적화 (어떤 Tier에서 어떤 agent가 가장 효율적인지)
- 문제-해결 쌍이 누적 (PgBouncer 이슈 → 다음 프로젝트에서 자동 방지)
- Convention이 정제 (검증된 규칙만 살아남음)
- 프로젝트 착수 시간이 극적으로 감소 (boilerplate + config + CI/CD = graph query 1회)

### Graph Layer Architecture

```
Layer 3: Meta Graph (cross-project)
  ├─ Universal Patterns    — 기술 스택 불문 보편 패턴
  ├─ Stack-Specific        — React/Supabase/AWS 등 스택별 패턴
  ├─ Agent Expertise       — 에이전트별 누적 전문성 프로필
  ├─ Problem Taxonomy      — 문제 분류 체계 (원인→해결 그래프)
  └─ Process Metrics       — 프로젝트 간 효율성 비교 데이터

Layer 2: Project Graph (per-project)
  ├─ Files & Dependencies  — 코드 구조 + import 관계
  ├─ Issues & Decisions    — 이슈 트래커 + 아키텍처 결정
  ├─ Sessions & Changes    — 작업 이력 + 변경 사항
  ├─ Agent Memory          — 프로젝트 특화 에이전트 지식
  └─ Retrospective Data    — 일일/주간 메트릭

Layer 1: Raw Data (source)
  ├─ .md files             — memory, troubleshooting, architecture
  ├─ Source code            — AST, imports, exports
  ├─ Git history           — commits, diffs, co-changes
  └─ GitHub Issues/PRs     — 이슈, PR, 코멘트
```

---

## Why GraphRAG

### Current Pain Points (Flat .md)
| 문제 | 영향 | 예시 |
|------|------|------|
| 선형 탐색 | Agent가 관련 정보를 찾기 위해 여러 .md를 순차 Read | "이 컴포넌트 관련 과거 이슈?" → troubleshooting + ux-issues + frontend-dev.md 모두 탐색 |
| 암묵적 관계 | 파일 간 연결이 텍스트 링크뿐 | Issue #71과 motion.ts의 관계가 명시적이지 않음 |
| 컨텍스트 손실 | 세션 간 맥락 전달이 수동 | /clear 후 새 세션에서 이전 결정 근거 추적 불가 |
| 중복/충돌 | 같은 정보가 여러 .md에 분산 | DB 규칙이 troubleshooting + architecture + cross-agent에 중복 |
| 스케일 한계 | 파일이 많아지면 어떤 파일을 읽어야 할지 판단 비용 증가 | 20개 memory 파일 중 현재 작업에 관련된 3개를 찾는 비용 |

### GraphRAG Benefits
| 개선 | 효과 | 측정 |
|------|------|------|
| 관계 기반 탐색 | "이 파일을 수정하면 영향받는 모든 것" 즉시 조회 | 탐색 토큰 -50% |
| 의미적 검색 | "과거 유사 문제" → 관련 노드 + 해결 경로 | 반복 실수율 -70% |
| 자동 컨텍스트 구성 | Agent spawn 시 그래프에서 필요한 컨텍스트 자동 추출 | 프리로드 정확도 +40% |
| 결정 추적 | "왜 이 설계를 선택했나?" → 결정 노드 → 근거 엣지 추적 | 아키텍처 일관성 +30% |
| 지식 그래프 성장 | 작업할수록 그래프가 풍부해짐 → 에이전트가 더 똑똑해짐 | 품질 점수 월간 +1 |

---

## Phase 0: Foundation (Current — .md 기반)

**상태**: 완료

현재 .md 파일들은 GraphRAG의 **seed data** 역할:

```
memory/
  MEMORY.md              → Project Entity (root node)
  architecture.md        → Architecture Decisions
  troubleshooting.md     → Problem-Solution Pairs
  credentials.md         → Infrastructure Entities
  retrospective.md       → Daily/Weekly Metrics
  ux-issues.md           → UX Problem Registry

.claude/agents/
  DELEGATION.md          → Workflow Policies
  memory/
    frontend-dev.md      → Agent:frontend Knowledge
    test-runner.md       → Agent:test Knowledge
    ux-designer.md       → Agent:ux Knowledge
    cross-agent.md       → Shared Conventions
    delegation-metrics.md → Efficiency Metrics
```

**Phase 0 수치 (baseline)**:
- Memory 파일: 12개
- 수동 크로스 레퍼런스: ~20개
- Agent 프리로드: 수동 (prompt에 Read 지시)
- 정보 탐색: 선형 (파일 순차 읽기)

---

## Phase 1: Entity Extraction & Schema Design

**목표**: .md 파일에서 엔티티와 관계를 정의하고 추출 파이프라인 설계

### Knowledge Graph Schema

```
Nodes (엔티티 타입):
  Project          — 프로젝트 메타데이터
  Agent            — 13개 에이전트 (역할, 도구, 트리거)
  File             — 소스 코드 파일 (경로, 타입, 도메인)
  Issue            — GitHub Issue (상태, 라벨, 의존성)
  Decision         — 아키텍처/기술 결정 (일시, 근거, 결과)
  Problem          — 과거 문제 (증상, 원인, 해결)
  Pattern          — 재사용 가능 패턴 (이름, 위치, 용도)
  Convention       — 프로젝트 규칙 (scope, 적용 대상)
  Metric           — 수치 데이터 (일자, 타입, 값)
  Session          — 작업 세션 (일자, 작업 목록, 결과)

Edges (관계 타입):
  OWNS             — Agent → File (담당 파일)
  DEPENDS_ON       — Issue → Issue (의존성)
  RESOLVED_BY      — Problem → Decision (해결 경로)
  USES_PATTERN     — File → Pattern (패턴 사용)
  VIOLATES         — Session → Convention (규칙 위반)
  MODIFIED_IN      — File → Session (변경 이력)
  SPAWNED          — Session → Agent (에이전트 활용)
  MEASURED_BY      — Session → Metric (수치 추적)
  RELATED_TO       — Any → Any (의미적 연관)
  CAUSED_BY        — Problem → File (원인 파일)
  LEARNED_FROM     — Pattern → Problem (학습 출처)
```

### Entity Extraction Pipeline

```
Source (.md files)
  │
  ├─ NLP Parser → Entity Recognition
  │   ├─ File paths → File nodes
  │   ├─ Issue references (#XX) → Issue nodes
  │   ├─ Agent names → Agent nodes
  │   ├─ Date patterns → temporal edges
  │   └─ Problem/Solution blocks → Problem/Decision nodes
  │
  ├─ Code Analysis → Structure Graph
  │   ├─ import/export → DEPENDS_ON edges
  │   ├─ file ownership → OWNS edges
  │   └─ test coverage → TESTED_BY edges
  │
  └─ Git History → Change Graph
      ├─ commits → Session nodes
      ├─ file changes → MODIFIED_IN edges
      └─ co-change frequency → RELATED_TO weight
```

**Deliverables**:
- [ ] Graph schema (Neo4j/NetworkX compatible)
- [ ] Entity extraction script (`scripts/extract-entities.py`)
- [ ] 초기 그래프 생성 (현재 .md에서 추출)

---

## Phase 2: Graph Storage & Query Layer

**목표**: 그래프 저장소 구축 + 에이전트가 쿼리할 수 있는 인터페이스

### Storage Options

| Option | 장점 | 단점 | 비용 |
|--------|------|------|------|
| **JSON-LD flat file** | 단순, git 추적 가능 | 쿼리 느림, 스케일 한계 | $0 |
| **SQLite + FTS5** | 로컬, 빠름, 전문검색 | 그래프 탐색 어려움 | $0 |
| **Neo4j (local)** | 네이티브 그래프 쿼리, Cypher | Docker 필요, 메모리 | $0 |
| **Supabase pgvector** | 기존 인프라, 벡터 검색 | 그래프 쿼리 추가 구현 | $0 (기존 무료) |

**추천**: 이미 Supabase PostgreSQL(pgvector 포함)이 운영 중이므로 **바로 PostgreSQL에 적재**. JSON-LD 중간 단계는 불필요한 마이그레이션 비용을 발생시킨다.

### Query Interface

```python
# Agent가 호출하는 GraphRAG API
class GraphRAG:
    def context_for_task(self, task: str) -> List[Node]:
        """작업 설명 → 관련 노드 + 관계 자동 추출"""

    def impact_analysis(self, file_path: str) -> List[Edge]:
        """파일 변경 시 영향받는 모든 엔티티"""

    def similar_problems(self, symptom: str) -> List[Problem]:
        """증상 → 유사 과거 문제 + 해결 경로"""

    def agent_knowledge(self, agent: str, topic: str) -> Context:
        """에이전트 + 주제 → 최적 컨텍스트 조합"""

    def decision_trace(self, decision: str) -> Graph:
        """결정 → 근거 → 관련 결정 → 영향 추적"""
```

**Deliverables**:
- [ ] Graph storage (Supabase PostgreSQL + pgvector)
- [ ] Query API (`scripts/graph-rag.py`)
- [ ] Agent 프리로드 자동화 (수동 Read → GraphRAG 쿼리)

---

## Phase 3: Embedding & Semantic Search

**목표**: 텍스트 임베딩으로 의미적 유사도 기반 검색 추가

### Embedding Pipeline

```
.md content + code comments + commit messages
  │
  ├─ Chunking (semantic boundaries)
  │   ├─ .md: heading 단위
  │   ├─ code: function/class 단위
  │   └─ commits: message + diff summary
  │
  ├─ Embedding (local model)
  │   ├─ Option A: sentence-transformers/all-MiniLM-L6-v2 (384d, fast)
  │   ├─ Option B: nomic-embed-text (768d, better quality)
  │   └─ Option C: Supabase pgvector + OpenAI ada-002 (1536d, cloud)
  │
  └─ Index
      ├─ Vector store (FAISS local or pgvector)
      └─ Graph node에 embedding 첨부
```

### Hybrid Search

```
Query: "카드 드래그 시 사라지는 버그"
  │
  ├─ Vector search → top-5 similar chunks
  │   → troubleshooting.md: "카드 D&D 추가 시 카드가 보였다 사라짐"
  │   → frontend-dev.md: "Optimistic UI rollback"
  │
  ├─ Graph traversal → related nodes
  │   → Problem:LIMIT_EXCEEDED → File:MandalaCell.tsx → Agent:frontend-dev
  │   → Pattern:optimistic-update → Convention:onSuccess-timing
  │
  └─ Merge & Rank → 최종 컨텍스트
      → 문제 원인 + 해결 방법 + 담당 agent + 관련 파일 일괄 반환
```

**Deliverables**:
- [ ] Embedding pipeline script
- [ ] Vector index (FAISS or pgvector)
- [ ] Hybrid search (vector + graph) 통합 API

---

## Phase 4: Autonomous Agent Integration

**목표**: Agent가 GraphRAG를 자동으로 활용하는 워크플로우 완성

### Auto Context Assembly

현재 (수동):
```
Agent(prompt="
[PRE-LOAD] Read: .claude/agents/memory/frontend-dev.md, cross-agent.md
[TASK] ...
")
```

GraphRAG (자동):
```
Agent(prompt="
[CONTEXT] {GraphRAG.context_for_task(task_description)}
[TASK] ...
")
```

GraphRAG가 자동으로:
1. Task 설명 분석 → 관련 노드 탐색
2. Agent memory에서 relevant patterns 추출
3. 과거 유사 작업의 성공/실패 경로 포함
4. 영향받는 파일 목록 + 의존성 그래프 첨부
5. 관련 Convention/Rule 자동 주입

### Feedback Loop

```
Agent 작업 완료
  │
  ├─ 결과 분석 → 새 노드/엣지 자동 생성
  │   ├─ 수정된 파일 → MODIFIED_IN edge
  │   ├─ 발견한 패턴 → Pattern node
  │   ├─ 해결한 문제 → Problem → RESOLVED_BY → Decision
  │   └─ 토큰 사용량 → Metric node
  │
  ├─ Retrospective 자동 생성
  │   ├─ 일일 메트릭 그래프에서 집계
  │   └─ 주간 트렌드 자동 분석
  │
  └─ Policy 자동 조정 제안
      ├─ Tier 미스매치 패턴 → 임계값 조정 제안
      ├─ Wasteful spawn 패턴 → 위임 규칙 개선 제안
      └─ 반복 문제 → Convention 추가 제안
```

**Deliverables**:
- [ ] Auto context assembly (GraphRAG → Agent prompt)
- [ ] Feedback loop (Agent result → Graph update)
- [ ] Retrospective auto-generation
- [ ] Policy adjustment suggestions

---

## Phase 5: MCP Server Integration

**목표**: GraphRAG를 MCP Server로 노출하여 Claude Code에서 네이티브 도구로 사용

### GraphRAG MCP Server

```yaml
name: graph-rag
tools:
  - query_context:      "작업에 필요한 컨텍스트 자동 조합"
  - impact_analysis:    "파일 변경 영향도 분석"
  - similar_problems:   "유사 과거 문제 검색"
  - decision_trace:     "결정 근거 추적"
  - update_graph:       "작업 결과로 그래프 업데이트"
  - weekly_review:      "주간 메트릭 분석 + 정책 제안"
resources:
  - knowledge_graph:    "현재 그래프 상태 조회"
  - agent_profiles:     "에이전트별 전문성 + 이력"
  - project_metrics:    "프로젝트 수치 대시보드"
```

**Usage in workflow**:
```
User: "Story #74 위젯 시스템 구현해줘"

Main:
  1. graph-rag.query_context("dashboard widget system, react-grid-layout")
     → 관련 파일, 패턴, 과거 유사 작업, agent 추천 자동 반환
  2. Tier 판정 (graph에서 파일 수/도메인 자동 계산)
  3. Agent spawn (graph context 자동 주입)
  4. 완료 후: graph-rag.update_graph(session_result)
```

**Deliverables**:
- [ ] GraphRAG MCP Server 구현
- [ ] Claude Code settings에 서버 등록
- [ ] End-to-end 워크플로우 검증

---

## Phase 6: Multi-Project Meta Graph

**목표**: 단일 프로젝트 그래프 → 프로젝트 간 지식 공유 + 신규 프로젝트 부트스트랩

### Meta Graph Schema (Layer 3)

```
Nodes (프로젝트 횡단):
  TechStack          — 기술 조합 (React+Tailwind+Supabase, Next.js+Prisma, etc.)
  UniversalPattern   — 기술 불문 보편 패턴 (optimistic UI, error boundary, retry logic)
  StackPattern       — 특정 스택 패턴 (Supabase RLS, Prisma migration, Vite chunking)
  AgentProfile       — 에이전트 누적 전문성 (어떤 작업에서 성공률이 높은지)
  ProblemClass       — 문제 분류 (DB connection, auth flow, bundle size, etc.)
  ProjectTemplate    — 프로젝트 boilerplate (CI/CD, infra, test setup)
  DelegationPolicy   — 검증된 위임 정책 (Tier 기준, agent 조합 효율)
  ProcessMetric      — 프로세스 수치 (프로젝트별 속도, 품질, 비용)

Edges (프로젝트 횡단):
  GENERALIZES        — Project Pattern → Universal Pattern (구체→추상 승격)
  INSTANTIATES       — Universal Pattern → Project Pattern (추상→구체 적용)
  TRANSFERS_TO       — Project A Knowledge → Project B (지식 전이)
  IMPROVES_UPON      — Policy v2 → Policy v1 (정책 진화)
  BENCHMARKS         — ProjectA Metric ←→ ProjectB Metric (비교)
  PROVEN_IN          — Pattern → [Project list] (검증 이력)
```

### New Project Bootstrap Flow

```
신규 프로젝트 착수
  │
  ├─ 1. Stack Detection
  │   "React + Supabase + AWS" → TechStack 노드 매칭
  │
  ├─ 2. Template Instantiation
  │   meta_graph.get_template("react-supabase-aws")
  │   → CI/CD workflows, Terraform modules, Docker configs
  │   → .claude/agents/ 디렉토리 (검증된 agent 설정)
  │   → DELEGATION.md (최적화된 Tier 정책)
  │   → memory/ 구조 (cross-agent.md 사전 구성)
  │
  ├─ 3. Pattern Injection
  │   meta_graph.patterns_for_stack("react-supabase")
  │   → PgBouncer 설정 규칙 (Insighta에서 학습)
  │   → Edge Function 배포 패턴 (--no-verify-jwt)
  │   → Optimistic UI + rollback 패턴
  │   → i18n 구조 (검증된 폴더 구조)
  │
  ├─ 4. Agent Calibration
  │   meta_graph.optimal_delegation("react-supabase", complexity)
  │   → Tier 임계값 조정 (이전 프로젝트 메트릭 기반)
  │   → Agent 조합 추천 (frontend-dev 성공률 데이터)
  │   → 토큰 예산 예측 (유사 프로젝트 실적)
  │
  └─ 5. Known Problems Pre-loading
      meta_graph.common_pitfalls("react-supabase-aws")
      → troubleshooting.md 사전 생성 (이미 알려진 함정)
      → Convention 사전 주입 (검증된 규칙)
```

---

## Ontology: Reality-Data 1:1 Mapping

**원칙**: 현실의 모든 엔티티, 관계, 이벤트가 데이터에 정확히 대응해야 한다. .md 파일은 임시 매체일 뿐, 궁극적으로 모든 지식은 **정규화된 DB**에 저장된다.

### Ontology Domain Model

```
Reality (현실)                    Data (DB)
─────────────────                ─────────────────
사람 (JK)                    →   User
프로젝트 (Insighta)           →   Project
에이전트 (frontend-dev)       →   Agent
소스 파일 (MandalaCell.tsx)   →   File
이슈 (#71)                   →   Issue
작업 세션 (2026-03-07)       →   Session
기술 결정 (dnd-kit 채택)      →   Decision
문제 (PgBouncer 충돌)        →   Problem
해결책 (pgbouncer=true)       →   Solution
패턴 (Optimistic UI)         →   Pattern
규칙 (Tier 3이면 PM 필수)     →   Convention
메트릭 (토큰 50K)            →   Metric
기술 스택 (React+Supabase)   →   TechStack
프로젝트 템플릿              →   ProjectTemplate
```

### Database Schema (PostgreSQL + pgvector / Supabase Cloud)

> 기존 Supabase Cloud에 `ontology` 스키마 추가. 별도 인프라 불필요.

```sql
-- Enable pgvector extension (Supabase Dashboard에서 활성화)
CREATE EXTENSION IF NOT EXISTS vector;

-- Separate schema for knowledge graph (RLS로 격리)
CREATE SCHEMA IF NOT EXISTS ontology;

-- ============================================================
-- Layer 1: Core Entities
-- ============================================================

CREATE TABLE ontology.projects (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL UNIQUE,
  repo_url      TEXT,
  tech_stack    TEXT[],               -- ['react', 'supabase', 'aws']
  status        TEXT DEFAULT 'active', -- active | archived | template
  created_at    TIMESTAMPTZ DEFAULT now(),
  metadata      JSONB DEFAULT '{}'    -- flexible project-specific data
);

CREATE TABLE ontology.agents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL UNIQUE,  -- 'frontend-dev', 'pm', etc.
  role          TEXT NOT NULL,
  tools         TEXT[],               -- ['Read','Write','Edit','Bash']
  trigger_paths TEXT[],               -- ['frontend/src/']
  trigger_keywords TEXT[],            -- ['component','React','UI']
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE ontology.files (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID REFERENCES ontology.projects(id) ON DELETE CASCADE,
  path          TEXT NOT NULL,         -- 'frontend/src/widgets/mandala-grid/ui/MandalaCell.tsx'
  domain        TEXT,                  -- 'frontend', 'backend', 'infra'
  language      TEXT,                  -- 'typescript', 'python'
  last_modified TIMESTAMPTZ,
  UNIQUE(project_id, path)
);

CREATE TABLE ontology.issues (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID REFERENCES ontology.projects(id) ON DELETE CASCADE,
  github_number INTEGER NOT NULL,
  title         TEXT NOT NULL,
  status        TEXT DEFAULT 'open',   -- open | in_progress | closed
  tier          INTEGER,               -- 1, 2, 3
  labels        TEXT[],
  created_at    TIMESTAMPTZ DEFAULT now(),
  closed_at     TIMESTAMPTZ,
  UNIQUE(project_id, github_number)
);

-- ============================================================
-- Layer 2: Knowledge Entities
-- ============================================================

CREATE TABLE ontology.decisions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID REFERENCES ontology.projects(id),
  title         TEXT NOT NULL,         -- 'dnd-kit 채택'
  rationale     TEXT,                  -- 'HTML5 DnD는 터치 미지원'
  alternatives  JSONB,                -- [{"name":"react-dnd","rejected_reason":"..."}]
  outcome       TEXT,                  -- 'success' | 'revised' | 'reverted'
  decided_at    TIMESTAMPTZ DEFAULT now(),
  decided_by    TEXT                   -- 'user' | 'agent:architect'
);

CREATE TABLE ontology.problems (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID REFERENCES ontology.projects(id),
  symptom       TEXT NOT NULL,         -- '카드가 보였다 사라짐'
  root_cause    TEXT,                  -- 'LIMIT_EXCEEDED 403'
  severity      TEXT,                  -- 'critical' | 'high' | 'medium' | 'low'
  discovered_at TIMESTAMPTZ DEFAULT now(),
  resolved_at   TIMESTAMPTZ,
  embedding     vector(384)            -- semantic search용
);

CREATE TABLE ontology.solutions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  problem_id    UUID REFERENCES ontology.problems(id) ON DELETE CASCADE,
  description   TEXT NOT NULL,
  code_snippet  TEXT,
  verified      BOOLEAN DEFAULT false,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE ontology.patterns (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,         -- 'optimistic-ui-rollback'
  description   TEXT,
  scope         TEXT DEFAULT 'project', -- 'project' | 'stack' | 'universal'
  tech_stack    TEXT[],                -- applicable stacks (null = universal)
  proven_count  INTEGER DEFAULT 1,     -- how many projects confirmed this
  example_path  TEXT,                  -- reference implementation file
  embedding     vector(384),
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE ontology.conventions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID REFERENCES ontology.projects(id), -- null = global convention
  rule          TEXT NOT NULL,         -- 'Edge Function 배포 시 --no-verify-jwt 필수'
  scope         TEXT DEFAULT 'project', -- 'project' | 'stack' | 'universal'
  enforcement   TEXT DEFAULT 'required', -- 'required' | 'recommended' | 'optional'
  violation_rate FLOAT DEFAULT 0,      -- 위반 시 실패율 (자동 계산)
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- 통합 Embeddings 테이블 (인라인 벡터 대체, 모든 엔티티 타입에 일관된 벡터 검색)
CREATE TABLE ontology.embeddings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL,       -- 'problem', 'pattern', 'decision', 'file', etc.
  entity_id   UUID NOT NULL,
  model       TEXT NOT NULL,       -- 'all-MiniLM-L6-v2'
  embedding   vector(384) NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(entity_type, entity_id, model)
);
CREATE INDEX idx_embeddings_vector ON ontology.embeddings
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 50);

-- ============================================================
-- Layer 3: Operational Entities
-- ============================================================

CREATE TABLE ontology.sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID REFERENCES ontology.projects(id) ON DELETE CASCADE,
  date          DATE NOT NULL,
  summary       TEXT,
  tier_1_count  INTEGER DEFAULT 0,
  tier_2_count  INTEGER DEFAULT 0,
  tier_3_count  INTEGER DEFAULT 0,
  total_tokens  INTEGER,               -- estimated
  quality_score FLOAT,                 -- 0-10
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE ontology.agent_spawns (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    UUID REFERENCES ontology.sessions(id) ON DELETE CASCADE,
  agent_id      UUID REFERENCES ontology.agents(id),
  issue_id      UUID REFERENCES ontology.issues(id),
  plan_id       UUID REFERENCES ontology.plans(id),  -- 어떤 plan에 의해 spawn되었는지 (Phase 8 Live Service)
  tier          INTEGER NOT NULL,      -- 1, 2, 3
  tokens_est    INTEGER,
  useful        BOOLEAN,               -- was this spawn productive?
  result        TEXT,                   -- 'APPROVED' | 'REJECTED' | 'CONDITIONS'
  duration_ms   INTEGER,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE ontology.metrics (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    UUID REFERENCES ontology.sessions(id) ON DELETE CASCADE,
  metric_type   TEXT NOT NULL,         -- 'token_efficiency', 'delegation_accuracy', etc.
  value         FLOAT NOT NULL,
  unit          TEXT,                  -- 'tokens', 'percent', 'score'
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- Layer 4: Relationship Edges (Graph in RDBMS)
-- ============================================================

CREATE TABLE ontology.edges (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID REFERENCES ontology.projects(id),  -- Multi-Project 격리 (Phase 6)
  source_type   TEXT NOT NULL,         -- 'file', 'issue', 'pattern', 'problem', etc.
  source_id     UUID NOT NULL,
  target_type   TEXT NOT NULL,
  target_id     UUID NOT NULL,
  relation      TEXT NOT NULL,         -- 'OWNS', 'DEPENDS_ON', 'RESOLVED_BY', etc.
  weight        FLOAT DEFAULT 1.0,     -- relationship strength
  metadata      JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE(source_type, source_id, target_type, target_id, relation)
);

CREATE INDEX idx_edges_source ON ontology.edges(source_type, source_id);
CREATE INDEX idx_edges_target ON ontology.edges(target_type, target_id);
CREATE INDEX idx_edges_relation ON ontology.edges(relation);
CREATE INDEX idx_edges_project ON ontology.edges(project_id);

-- 누락 인덱스: 빈번한 조회 패턴 최적화
CREATE INDEX idx_sessions_project_date ON ontology.sessions(project_id, date);
CREATE INDEX idx_spawns_session_agent ON ontology.agent_spawns(session_id, agent_id);
CREATE INDEX idx_problems_project_severity ON ontology.problems(project_id, severity);
CREATE INDEX idx_signals_project_status ON ontology.signals(project_id, status, created_at);

-- ============================================================
-- Layer 5: Meta Graph (Cross-Project)
-- ============================================================

CREATE TABLE ontology.tech_stacks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL UNIQUE,  -- 'react-supabase-aws'
  components    TEXT[] NOT NULL,       -- ['react', 'supabase', 'aws', 'tailwind']
  project_count INTEGER DEFAULT 0,     -- how many projects use this stack
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE ontology.project_templates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tech_stack_id UUID REFERENCES ontology.tech_stacks(id),
  name          TEXT NOT NULL,
  files         JSONB NOT NULL,        -- template file structure
  delegation_policy JSONB,             -- optimal tier thresholds for this stack
  conventions   UUID[],                -- reference to proven conventions
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE ontology.knowledge_transfers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_project UUID REFERENCES ontology.projects(id),
  target_project UUID REFERENCES ontology.projects(id),
  pattern_id    UUID REFERENCES ontology.patterns(id),
  transfer_type TEXT,                  -- 'pattern' | 'convention' | 'template' | 'pitfall'
  success       BOOLEAN,              -- did the transfer actually help?
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- Views: Aggregated Intelligence
-- ============================================================

-- Project health dashboard
CREATE VIEW ontology.v_project_health AS
SELECT
  p.name AS project,
  COUNT(DISTINCT s.id) AS total_sessions,
  AVG(s.quality_score) AS avg_quality,
  SUM(s.total_tokens) AS total_tokens,
  SUM(s.tier_1_count + s.tier_2_count + s.tier_3_count) AS total_tasks,
  ROUND(AVG(s.tier_1_count::float / NULLIF(s.tier_1_count + s.tier_2_count + s.tier_3_count, 0)) * 100, 1) AS tier1_pct
FROM ontology.projects p
LEFT JOIN ontology.sessions s ON s.project_id = p.id
GROUP BY p.id, p.name;

-- Agent effectiveness (cross-project)
-- NULL 처리: useful/result가 NULL인 경우 집계에서 제외 (NULL ≠ false)
CREATE VIEW ontology.v_agent_effectiveness AS
SELECT
  a.name AS agent,
  COUNT(asp.id) AS total_spawns,
  ROUND(
    AVG(CASE WHEN asp.useful = true THEN 1.0
             WHEN asp.useful = false THEN 0.0
             ELSE NULL END) * 100, 1
  ) AS useful_pct,
  ROUND(AVG(asp.tokens_est)) AS avg_tokens,
  ROUND(
    AVG(CASE WHEN asp.result = 'APPROVED' THEN 1.0
             WHEN asp.result IS NOT NULL THEN 0.0
             ELSE NULL END) * 100, 1
  ) AS approval_pct
FROM ontology.agents a
LEFT JOIN ontology.agent_spawns asp ON asp.agent_id = a.id
GROUP BY a.id, a.name;

-- Pattern maturity (promotion tracking)
CREATE VIEW ontology.v_pattern_maturity AS
SELECT
  pt.name,
  pt.scope,
  pt.proven_count,
  ARRAY_AGG(DISTINCT p.name) AS used_in_projects,
  CASE
    WHEN pt.proven_count >= 3 AND pt.scope = 'stack' THEN 'promote_to_universal'
    WHEN pt.proven_count >= 2 AND pt.scope = 'project' THEN 'promote_to_stack'
    ELSE 'keep'
  END AS promotion_action
FROM ontology.patterns pt
LEFT JOIN ontology.edges e ON e.source_type = 'pattern' AND e.source_id = pt.id AND e.relation = 'PROVEN_IN'
LEFT JOIN ontology.projects p ON e.target_type = 'project' AND e.target_id = p.id
GROUP BY pt.id, pt.name, pt.scope, pt.proven_count;

-- Improvement velocity (the ultimate KPI)
CREATE VIEW ontology.v_improvement_velocity AS
SELECT
  p.name AS project,
  p.created_at,
  EXTRACT(EPOCH FROM (MAX(s.date) - MIN(s.date))) / 86400 AS duration_days,
  SUM(s.total_tokens) AS total_tokens,
  AVG(s.quality_score) AS avg_quality,
  ROW_NUMBER() OVER (ORDER BY p.created_at) AS project_number
FROM ontology.projects p
JOIN ontology.sessions s ON s.project_id = p.id
WHERE p.status != 'template'
GROUP BY p.id, p.name, p.created_at;
```

### Entity-Relationship Diagram

```
                                ┌───────────┐
                    ┌──OWNS───→│   File    │←──MODIFIED_IN──┐
                    │           └─────┬─────┘                │
              ┌─────┴─────┐          │                 ┌─────┴─────┐
              │   Agent   │     DEPENDS_ON             │  Session  │
              └─────┬─────┘          │                 └─────┬─────┘
                    │           ┌────┴─────┐                 │
               SPAWNED_IN      │  Issue   │            MEASURED_BY
                    │          └────┬─────┘                  │
              ┌─────┴─────┐        │                  ┌──────┴──────┐
              │  Spawn    │   RESOLVED_BY              │   Metric   │
              └───────────┘        │                  └─────────────┘
                              ┌────┴──────┐
              ┌──CAUSED_BY──→│  Problem  │──RESOLVED_BY──→┌──────────┐
              │               └───────────┘                │ Solution │
         ┌────┴────┐                                       └──────────┘
         │  File   │──USES──→┌──────────┐
         └─────────┘         │ Pattern  │──PROVEN_IN──→┌──────────┐
                             └────┬─────┘              │ Project  │
                            LEARNED_FROM               └────┬─────┘
                                  │                         │
                            ┌─────┴──────┐            USES_STACK
                            │  Problem   │                  │
                            └────────────┘            ┌─────┴──────┐
                                                      │ TechStack  │
         ┌───────────┐                                └────────────┘
         │Convention │──ENFORCED_IN──→ Project
         └─────┬─────┘
               │
          VIOLATED_IN──→ Session (violation tracking)
```

### Knowledge Promotion Pipeline



```
Project Graph에서 반복 확인된 패턴
  │
  ├─ 출현 횟수 ≥ 2 projects → StackPattern 후보
  ├─ 출현 횟수 ≥ 3 projects → UniversalPattern 승격
  ├─ 성공률 ≥ 80% → PROVEN_IN edge 추가
  └─ 실패 패턴 → Anti-pattern 등록 (자동 경고)

Promotion criteria:
  Pattern:
    - 2+ projects에서 동일 패턴 출현 → StackPattern
    - 3+ stacks에서 동일 패턴 출현 → UniversalPattern

  Convention:
    - 위반 시 실패율 > 50% → 강제 Convention으로 승격
    - 위반 시 영향 없음 → 폐기 또는 Optional로 강등

  Delegation Policy:
    - Tier 정확도 > 90% for 4+ weeks → 확정 정책
    - 특정 agent 조합 성공률 > 85% → 추천 조합으로 등록
```

### Cross-Project Metrics Dashboard

```
┌─────────────────────────────────────────────────────────────┐
│                    META KNOWLEDGE DASHBOARD                   │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  PROJECTS           KNOWLEDGE GROWTH          EFFICIENCY      │
│  ● Insighta (active)  Nodes: 1,247 (+52/wk)   1st proj: 45d │
│  ○ Project B (plan)   Edges: 3,891 (+180/wk)   2nd proj: 28d │
│                       Patterns: 89 (23 proven)  3rd proj: 18d │
│                       Problems: 156 (142 solved) (target: 12d)│
│                                                               │
│  AGENT EFFICIENCY (cross-project)                             │
│  frontend-dev:  92% useful spawns  avg 35K tokens             │
│  test-runner:   88% useful spawns  avg 28K tokens             │
│  pm:            95% accurate       avg 15K tokens             │
│                                                               │
│  KNOWLEDGE TRANSFER                                           │
│  Insighta → Project B:  47 patterns transferable              │
│  Bootstrap coverage:     73% (est. 2 days setup → 0.5 day)   │
│                                                               │
│  TREND: Project delivery time (normalized complexity)         │
│  ████████████████████████████  45d  (Project 1)               │
│  ██████████████████           28d  (Project 2, projected)     │
│  ████████████                 18d  (Project 3, projected)     │
└─────────────────────────────────────────────────────────────┘
```

**Deliverables**:
- [ ] Meta Graph schema + storage (별도 repo 또는 global .claude/)
- [ ] Knowledge promotion pipeline (project → meta 승격 로직)
- [ ] Project bootstrap CLI (`graph-rag bootstrap --stack react-supabase`)
- [ ] Cross-project metrics aggregation

---

## Phase 7: Self-Evolving System

**목표**: 시스템이 자체적으로 정책/패턴/에이전트를 최적화하는 자율 진화

### Autonomous Optimization Loop

```
                 ┌──────────────┐
                 │  Meta Graph  │
                 └──────┬───────┘
                        │
              ┌─────────┼─────────┐
              ▼         ▼         ▼
         ┌────────┐ ┌────────┐ ┌────────┐
         │Analyze │ │Predict │ │Optimize│
         │metrics │ │outcomes│ │policies│
         └───┬────┘ └───┬────┘ └───┬────┘
             │          │          │
             └─────┬────┘          │
                   ▼               │
            ┌────────────┐        │
            │  Propose   │        │
            │  changes   │◄───────┘
            └─────┬──────┘
                  │
                  ▼
            ┌────────────┐
            │  Human     │  ← 승인/거부/수정
            │  Review    │
            └─────┬──────┘
                  │
                  ▼
            ┌────────────┐
            │  Apply &   │
            │  Measure   │───→ back to Meta Graph
            └────────────┘
```

### What Self-Evolves

| 대상 | 현재 (수동) | Phase 7 (자율) |
|------|-----------|---------------|
| **Tier 임계값** | DELEGATION.md 수동 편집 | 메트릭 분석 → 최적 임계값 제안 → 유저 승인 → 자동 적용 |
| **Agent 조합** | 고정 트리오 규칙 | 작업 유형별 최적 조합 학습 → 동적 추천 |
| **토큰 예산** | ~50K/agent 고정 추정 | 과거 실적 기반 예측 → 동적 할당 |
| **프리로드 컨텍스트** | 수동 파일 지정 | 작업 설명 → 최적 컨텍스트 자동 구성 |
| **Convention** | 수동 추가/삭제 | 위반-결과 상관 분석 → 자동 승격/폐기 제안 |
| **Issue template** | 고정 템플릿 | 과거 성공 이슈 분석 → 템플릿 자동 개선 |
| **Retrospective** | 수동 작성 | 세션 데이터 자동 집계 → 인사이트 자동 생성 |

### Improvement Velocity Formula

```
V(n) = V(1) * (1 + learning_rate * ln(n))

Where:
  V(n)          = n번째 프로젝트의 실행 속도
  V(1)          = 첫 프로젝트 baseline 속도
  learning_rate = Meta Graph 성장률 (목표: 0.15~0.25 per project)
  n             = 완료된 프로젝트 수

Note: 로그 수렴 모델 사용 — 지수 성장(^n)은 비현실적이며,
      실제 학습 곡선은 초기에 빠르고 점차 수렴한다.

Example (learning_rate = 0.20):
  Project 1:  1.00x (baseline)         -- ln(1) = 0
  Project 2:  1.14x faster             -- ln(2) ≈ 0.69
  Project 3:  1.22x faster             -- ln(3) ≈ 1.10
  Project 5:  1.32x faster             -- ln(5) ≈ 1.61
  Project 10: 1.46x faster             -- ln(10) ≈ 2.30
```

### Safety Guardrails

자율 진화에는 반드시 안전장치:

```
1. Human-in-the-loop: 모든 정책 변경은 유저 승인 필수
2. Rollback: 정책 변경 후 품질 하락 감지 시 자동 롤백
3. A/B testing: 새 정책은 일부 작업에만 적용 후 비교
4. Confidence threshold: 제안 신뢰도 > 80%일 때만 표면화
5. Audit trail: 모든 자율 결정의 근거를 그래프에 기록
```

**Deliverables**:
- [ ] Autonomous optimization engine
- [ ] Proposal → Review → Apply pipeline
- [ ] A/B testing framework for policies
- [ ] Improvement velocity tracking

---

## Phase 8: Live Service Intelligence

**목표**: "프로젝트 완료" 이후에도 서비스가 자율적으로 개선되는 운영 모드.
새로운 요구가 들어오면 분석 → 구현 → 테스트 → 배포까지 **단일 파이프라인**으로 실행.

### 패러다임 전환

```
기존 (Phase 0-7):
  요구사항 → [인간이 분석] → [인간이 지시] → [Agent 구현] → [인간이 검증] → 배포

Phase 8 (Live Service):
  요구사항 → [시스템이 분석+계획+구현+테스트+배포] → [인간은 승인만]
```

**"프로젝트 완료"의 재정의**:
- 기존: 코드 작성 끝, 배포 끝 = 완료
- Phase 8: 서비스가 **자율 개선 모드**에 진입 = 시작

### Live Service Loop

```
┌──────────────────────────────────────────────────────────┐
│                  LIVE SERVICE LOOP                         │
│                                                           │
│  Signal Detection                                         │
│  ┌─────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐ │
│  │ User    │ │ Error    │ │ Perf     │ │ External     │ │
│  │ Feedback│ │ Tracking │ │ Degradat.│ │ API Change   │ │
│  └────┬────┘ └────┬─────┘ └────┬─────┘ └──────┬───────┘ │
│       └──────┬────┘────────┬───┘───────────────┘         │
│              ▼             ▼                              │
│  ┌───────────────────────────────┐                       │
│  │   Requirement Classifier      │                       │
│  │   (GraphRAG + Ontology)       │                       │
│  │                               │                       │
│  │   "무엇이 필요한가?"           │                       │
│  │   → Tier 판정                 │                       │
│  │   → 영향 범위 분석            │                       │
│  │   → 유사 과거 변경 조회       │                       │
│  └──────────┬────────────────────┘                       │
│             ▼                                            │
│  ┌───────────────────────────────┐                       │
│  │   Plan Generator              │                       │
│  │                               │                       │
│  │   "어떻게 구현할 것인가?"      │                       │
│  │   → Agent 조합 결정           │                       │
│  │   → 파일 변경 계획            │                       │
│  │   → 테스트 전략               │                       │
│  │   → 롤백 계획                 │                       │
│  └──────────┬────────────────────┘                       │
│             ▼                                            │
│  ┌───────────────────────────────┐                       │
│  │   Human Gate (승인)           │  ← Tier 1: 자동 승인  │
│  │                               │  ← Tier 2: 알림 후    │
│  │   계획서 리뷰 + 승인/거부     │     자동 (30분 대기)  │
│  │                               │  ← Tier 3: 명시적     │
│  └──────────┬────────────────────┘     수동 승인 필수     │
│             ▼                                            │
│  ┌───────────────────────────────┐                       │
│  │   Execution Engine            │                       │
│  │                               │                       │
│  │   Agent(s) → QA → PM         │                       │
│  │   → Branch 생성               │                       │
│  │   → 코드 변경                 │                       │
│  │   → 테스트 실행               │                       │
│  │   → PR 생성                   │                       │
│  └──────────┬────────────────────┘                       │
│             ▼                                            │
│  ┌───────────────────────────────┐                       │
│  │   Deploy Pipeline             │                       │
│  │                               │                       │
│  │   CI → Build → Stage → Canary │                       │
│  │   → Health Check              │                       │
│  │   → Full Deploy OR Rollback   │                       │
│  └──────────┬────────────────────┘                       │
│             ▼                                            │
│  ┌───────────────────────────────┐                       │
│  │   Feedback Capture            │                       │
│  │                               │                       │
│  │   → 배포 결과 → Graph 업데이트│                       │
│  │   → 메트릭 수집               │                       │
│  │   → 패턴 학습                 │                       │
│  │   → 다음 요구에 더 빠르게     │                       │
│  └───────────────────────────────┘                       │
└──────────────────────────────────────────────────────────┘
```

### Signal Sources (요구 감지)

| Signal | Source | Example | Auto-Tier |
|--------|--------|---------|-----------|
| **User Feedback** | PostHog survey, GitHub Issue, Support | "검색이 느려요" | T2-T3 |
| **Error Spike** | PostHog error tracking, Sentry | 500 error rate > 1% | T1-T2 |
| **Performance Degradation** | Lighthouse CI, Core Web Vitals | LCP > 3s | T2 |
| **Dependency Update** | Dependabot, npm audit | Critical vulnerability | T1-T2 |
| **API Breaking Change** | External API monitoring | YouTube API v4 deprecation | T3 |
| **Usage Pattern** | PostHog analytics | 특정 기능 사용률 급증 | T2 |
| **Capacity Threshold** | CloudWatch, ops-dashboard | DB 80% full | T1 |
| **Compliance Change** | Manual input | GDPR 규정 변경 | T3 |

### Autonomous Tier Handling

```yaml
tier_1_auto:
  description: "사소한 수정, 자동 실행 가능"
  examples:
    - dependency patch update (no breaking changes)
    - error message 개선
    - config 값 조정
  human_gate: "알림만 (사후 리뷰)"
  deploy: "자동 (canary → full)"
  rollback: "자동 (health check 실패 시)"

tier_2_semi_auto:
  description: "중간 규모, 계획 확인 후 자동 실행"
  examples:
    - 성능 최적화 (쿼리, 번들)
    - UI 컴포넌트 개선
    - 새 API 엔드포인트 추가
  human_gate: "계획서 알림 → 30분 대기 → 이의 없으면 실행"
  deploy: "PR 자동 생성 → CI 통과 → 자동 머지"
  rollback: "자동 + 인간 알림"

tier_3_human_required:
  description: "대규모 변경, 반드시 인간 승인"
  examples:
    - 아키텍처 변경
    - DB 스키마 마이그레이션
    - 새 외부 서비스 연동
    - 보안 관련 변경
  human_gate: "계획서 리뷰 → 명시적 승인 → 실행"
  deploy: "Staging → 인간 확인 → Production"
  rollback: "인간 결정"
```

### Canary Deploy Integration

```
Code Change → PR → CI Pass
  │
  ├─ Canary (5% traffic, 10분)
  │   ├─ Error rate < baseline → Proceed
  │   ├─ Error rate > baseline → Auto-rollback + Alert
  │   └─ Latency > 2x baseline → Auto-rollback + Alert
  │
  ├─ Gradual (25% → 50% → 100%, 각 5분)
  │   └─ 각 단계에서 health check
  │
  └─ Full Deploy
      └─ Graph update: Session + Metric + Pattern 기록
```

### Service Evolution Timeline

```
Day 1-N:     개발 (Phase 0-7)
Day N:       "프로젝트 완료" → 서비스 런칭
Day N+1:     Live Service Loop 활성화
             │
             ├─ 에러 감지 → 자동 패치 (T1)
             ├─ 성능 하락 → 최적화 실행 (T2)
             ├─ 유저 피드백 → 기능 개선 제안 (T2-T3)
             └─ 시장 변화 → 대규모 개편 계획 (T3)
             │
Day N+30:    월간 리뷰
             ├─ 자동 처리된 T1: 47건
             ├─ 반자동 T2: 12건 (인간 리뷰 평균 5분)
             ├─ 수동 T3: 3건 (인간 설계 참여)
             └─ 서비스 가용성: 99.95%
             │
Day N+90:    분기 리뷰
             ├─ T1 자동 처리 정확도: 98%
             ├─ T2 계획 품질: 인간 수정률 < 5%
             └─ 전체 변경의 85%가 인간 개입 최소화
```

### DB Schema Extension (Live Service)

```sql
-- Signal: 서비스에서 감지된 요구/이벤트
CREATE TABLE ontology.signals (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID REFERENCES ontology.projects(id),
  source        TEXT NOT NULL,        -- 'posthog', 'github', 'cloudwatch', 'user', 'dependabot'
  signal_type   TEXT NOT NULL,        -- 'error_spike', 'perf_degradation', 'user_feedback', 'dependency', 'capacity'
  severity      TEXT NOT NULL,        -- 'critical', 'high', 'medium', 'low'
  title         TEXT NOT NULL,
  raw_data      JSONB,               -- source-specific payload
  auto_tier     INTEGER,             -- system's tier assessment
  status        TEXT DEFAULT 'new',   -- 'new', 'planning', 'approved', 'executing', 'deployed', 'resolved', 'rejected'
  created_at    TIMESTAMPTZ DEFAULT now(),
  resolved_at   TIMESTAMPTZ
);

-- Plan: 시스템이 생성한 실행 계획
CREATE TABLE ontology.plans (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id     UUID REFERENCES ontology.signals(id),
  tier          INTEGER NOT NULL,
  summary       TEXT NOT NULL,
  file_changes  JSONB NOT NULL,       -- [{path, action, description}]
  agent_assignment JSONB NOT NULL,    -- [{agent, role, context_files}]
  test_strategy TEXT,
  rollback_plan TEXT,
  estimated_tokens INTEGER,
  confidence    FLOAT,                -- 0.0-1.0 system's confidence in this plan
  human_approved BOOLEAN,
  approved_at   TIMESTAMPTZ,
  approved_by   TEXT,                 -- 'auto' | 'user:JK'
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- Deployment: 배포 이력 (canary 포함)
CREATE TABLE ontology.deployments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id       UUID REFERENCES ontology.plans(id),
  commit_sha    TEXT,
  pr_number     INTEGER,
  canary_result TEXT,                 -- 'pass', 'fail', 'skipped'
  deploy_result TEXT,                 -- 'success', 'rolled_back', 'failed'
  error_rate_before FLOAT,
  error_rate_after  FLOAT,
  latency_before    FLOAT,
  latency_after     FLOAT,
  deployed_at   TIMESTAMPTZ DEFAULT now()
);

-- Service health: 서비스 상태 시계열
-- 중복 plan 방지: signal당 최신 plan만 조인 (DISTINCT ON)
CREATE VIEW ontology.v_service_evolution AS
WITH latest_plans AS (
  SELECT DISTINCT ON (signal_id) *
  FROM ontology.plans
  ORDER BY signal_id, created_at DESC
)
SELECT
  DATE_TRUNC('week', s.created_at) AS week,
  COUNT(CASE WHEN s.status = 'resolved' AND p.tier = 1 THEN 1 END) AS auto_resolved_t1,
  COUNT(CASE WHEN s.status = 'resolved' AND p.tier = 2 THEN 1 END) AS semi_auto_t2,
  COUNT(CASE WHEN s.status = 'resolved' AND p.tier = 3 THEN 1 END) AS manual_t3,
  ROUND(AVG(CASE WHEN p.human_approved AND p.approved_by = 'auto' THEN 1 ELSE 0 END) * 100, 1) AS auto_approval_pct,
  ROUND(AVG(d.error_rate_after - d.error_rate_before), 4) AS avg_error_delta,
  ROUND(AVG(EXTRACT(EPOCH FROM (s.resolved_at - s.created_at)) / 3600), 1) AS avg_resolution_hours
FROM ontology.signals s
LEFT JOIN latest_plans p ON p.signal_id = s.id
LEFT JOIN ontology.deployments d ON d.plan_id = p.id
GROUP BY DATE_TRUNC('week', s.created_at)
ORDER BY week;
```

### The Ultimate Vision

```
                    ┌──────────────────────────┐
                    │     LIVE SERVICE          │
                    │     (insighta.one)        │
                    └─────────┬────────────────┘
                              │ signals
                              ▼
                    ┌──────────────────────────┐
                    │     GraphRAG Brain        │
                    │                          │
                    │  Ontology (현실 1:1)      │
                    │  Meta Graph (N projects)  │
                    │  Pattern Library          │
                    │  Decision History         │
                    └─────────┬────────────────┘
                              │ plans
                              ▼
                    ┌──────────────────────────┐
                    │     Agent Orchestra       │
                    │                          │
                    │  Analyze → Plan           │
                    │  Implement → Test         │
                    │  Review → Deploy          │
                    └─────────┬────────────────┘
                              │ changes
                              ▼
                    ┌──────────────────────────┐
                    │     LIVE SERVICE          │
                    │     (improved)            │
                    │                          │
                    │  → 더 빠름               │
                    │  → 더 안정적             │
                    │  → 더 많은 기능          │
                    │  → 시간이 갈수록 진화     │
                    └──────────────────────────┘
```

**핵심**: 서비스는 살아있는 유기체처럼 환경(유저, 시장, 기술)에 반응하여 지속적으로 진화한다.
인간은 방향을 설정하고 중대한 결정을 승인하는 역할로 전환된다.
시스템은 시간이 갈수록 더 정확하고 빠르게 자체 개선한다.

**Deliverables**:
- [ ] Signal detection pipeline (PostHog + GitHub + CloudWatch → GraphRAG)
- [ ] Requirement classifier (signal → tier + impact analysis)
- [ ] Plan generator (auto plan with confidence score)
- [ ] Human gate system (tier-based approval workflow)
- [ ] Canary deploy pipeline
- [ ] Service evolution dashboard (v_service_evolution view)

---

## Implementation Timeline

| Phase | 기간 | 선행조건 | 핵심 산출물 | Scope |
|-------|------|---------|------------|-------|
| 0 Foundation | 완료 | — | .md 파일 체계 | Single project |
| 1 Entity Extraction | 2-3주 | Phase 0 | 그래프 스키마, 추출 스크립트 | Single project |
| 2 Storage & Query | 1-2주 | Phase 1 | PostgreSQL + pgvector 저장소 (JSON-LD 건너뜀) | Single project |
| 3 Embedding & Search | 2-3주 | Phase 2 | 벡터 인덱스, Hybrid search | Single project |
| 4 Agent Integration | **4-6주** | Phase 3 | Auto context, Feedback loop | Single project |
| 5 MCP Server | 2-3주 | Phase 4 | MCP Server, E2E 워크플로우 | Single project |
| 6 Multi-Project | 6-8주 | Phase 5 | Meta Graph, Bootstrap CLI | Multi project |
| 7 Self-Evolving | **8-12주** | Phase 6 | MVP: 메트릭 기반 제안 → 인간 승인 → 수동 적용 | System-wide |
| **8 Live Service** | **4-6주 MVP + ongoing** | **Phase 7** | **Signal→Plan→Deploy pipeline** | **Production** |

**총 예상: 30-44주 (Phase 1~8 MVP)** — architect 리뷰 반영, 기존 16-26주 대비 약 1.7배
- Phase 1-5 (단일 프로젝트 GraphRAG): 11-17주
- Phase 6-7 (멀티 프로젝트 + 자율 진화): 14-20주 (Phase 4, 7이 가장 난이도 높음)
- Phase 8 (Live Service): 4-6주 MVP → 이후 무기한 운영
- Phase 7 MVP 스코프 축소: "자율 최적화" → "메트릭 기반 제안 생성 → 인간 승인 → 수동 적용". 자동 적용은 Phase 7.1로 분리.

---

## Success Metrics

### Single Project Metrics (Phase 0→5)

| Metric | Phase 0 (현재) | Phase 5 (목표) | 측정 방법 |
|--------|---------------|---------------|----------|
| 컨텍스트 정확도 | ~60% (수동 판단) | >90% (자동 추출) | 관련 파일 적중률 |
| 탐색 토큰 | ~30K/task | <10K/task | delegation-metrics |
| 반복 실수율 | ~15% | <3% | retrospective 집계 |
| Agent 프리로드 시간 | ~5K tokens (수동 Read) | ~2K tokens (graph query) | 프리로드 토큰 비교 |
| 정보 발견 시간 | 3-5 file reads | 1 graph query | 쿼리 횟수 |
| 주간 리뷰 시간 | 수동 30min | 자동 5min + 리뷰 10min | 소요 시간 |

### Multi-Project Metrics (Phase 6→7)

| Metric | Project 1 | Project 3 | Project 10 | 측정 방법 |
|--------|-----------|-----------|------------|----------|
| 프로젝트 셋업 시간 | 2-3일 | 4시간 | 30분 | 첫 커밋까지 소요 시간 |
| 프로젝트 전체 기간 | baseline | -30% | -60% | 착수→완료 calendar days |
| 부트스트랩 커버리지 | 0% | 70% | 90% | 재사용 패턴 / 전체 패턴 |
| 크로스 프로젝트 패턴 | 0 | 50+ | 200+ | Meta Graph 노드 수 |
| Agent 첫 성공률 | ~70% | ~85% | ~95% | PM 재작업 없이 APPROVED |
| 토큰 효율 (동일 작업) | baseline | -25% | -50% | 유사 작업 토큰 비교 |

### System-Level Metrics (궁극 KPI)

```
Improvement Velocity = V(n) = V(1) * (1 + learning_rate * ln(n))
  -- 로그 수렴 모델 (지수 성장 가정은 비현실적)
  Target: ~1.3x by Project 5, ~1.5x by Project 10 (learning_rate = 0.20)

Knowledge Reuse Rate = (reused patterns) / (total patterns needed)
  Target: > 70% by Project 3, > 90% by Project 10

Autonomous Decision Accuracy = (auto-approved proposals) / (total proposals)
  Target: > 80% by Phase 7 month 3
```
