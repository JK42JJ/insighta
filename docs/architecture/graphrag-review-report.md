# GraphRAG Roadmap 전문 리서치 리포트

**문서**: `docs/graph-rag-roadmap.md` 검증 결과
**검증자**: Architect Persona (시스템 설계 전문)
**날짜**: 2026-03-07

---

## 1. DB 스키마 리뷰

### 적절한 점

1. **스키마 분리 (`ontology` schema)**: 기존 `public` 스키마(Insighta 앱 데이터)와 완전 분리하여 관심사를 격리한 점은 좋다. Supabase Cloud의 multi-schema 지원을 적절히 활용한다.

2. **레이어별 테이블 구성**: Core Entities(Layer 1) → Knowledge Entities(Layer 2) → Operational Entities(Layer 3) → Edges(Layer 4) → Meta Graph(Layer 5) 순서가 논리적이다. 의존성 방향이 명확하다.

3. **`sessions` 테이블의 집계 컬럼**: `tier_1_count`, `tier_2_count`, `tier_3_count`를 세션 레벨에서 미리 집계하는 설계는 실용적이다. 매번 `agent_spawns`를 조인하여 집계하는 것보다 읽기 성능이 좋다.

4. **`solutions` 테이블 분리**: `problems`에서 `solutions`를 1:N으로 분리한 것은 정확하다. 하나의 문제에 여러 해결 시도가 있을 수 있고, 각각의 `verified` 상태를 추적하는 것이 유용하다.

5. **`knowledge_transfers` 테이블**: 프로젝트 간 지식 전이를 명시적으로 추적하는 것은 Meta Graph의 핵심 가치를 반영한다.

### 개선 필요 사항

#### 1-A. edges 테이블의 EAV 패턴 — 심각한 성능 우려

현재 `edges` 테이블은 Entity-Attribute-Value(EAV) 패턴의 변형이다:

```sql
CREATE TABLE ontology.edges (
  source_type TEXT NOT NULL,  -- 어떤 테이블인지 텍스트로
  source_id   UUID NOT NULL,  -- FK 제약 없음
  target_type TEXT NOT NULL,
  target_id   UUID NOT NULL,
  relation    TEXT NOT NULL,
  ...
);
```

**문제점**:
- **참조 무결성 없음**: `source_id`와 `target_id`가 실제 존재하는 레코드를 가리키는지 DB 레벨에서 보장할 수 없다. 삭제된 엔티티를 가리키는 dangling edge가 발생한다.
- **조인 비용**: 특정 엔티티의 모든 관계를 조회하려면 `source_type` 조건으로 분기한 뒤 해당 테이블과 동적 조인해야 한다. PostgreSQL의 쿼리 플래너가 이를 최적화하기 어렵다.
- **인덱스 효율**: `idx_edges_source(source_type, source_id)`는 복합 인덱스지만, `source_type`의 카디널리티가 낮아(약 10종) 인덱스 선택도가 떨어진다.

**현재 스케일(수천 노드)에서는** 문제가 되지 않는다. 그러나 노드 10K+, 엣지 50K+ 시점에서 `edges` 조인이 가장 먼저 병목이 된다.

**권장**: 현재 설계로 시작하되, edges 테이블에 파티셔닝 전략을 미리 정의해둘 것. 또는 아래 대안 참조.

#### 1-B. pgvector dimension 384 선택 — 조건부 적절

`vector(384)`는 `all-MiniLM-L6-v2` 모델 기준이다. 이 선택의 트레이드오프:

| 차원 | 모델 | 품질 | 인덱스 크기 | Supabase 무료 호환 |
|------|------|------|-------------|-------------------|
| 384 | all-MiniLM-L6-v2 | 중 | 작음 | 문제 없음 |
| 768 | nomic-embed-text | 중상 | 2x | 가능하나 여유 감소 |
| 1536 | text-embedding-ada-002 | 상 | 4x | 무료 티어 저장 압박 |
| 3072 | text-embedding-3-large | 최상 | 8x | 무료 티어 비현실적 |

**384d는 현재 스케일에서 합리적이다.** 다만 로드맵에서 `problems.embedding`과 `patterns.embedding`에만 벡터를 두고, `files`, `decisions`, `conventions` 등에는 두지 않은 점이 비일관적이다. 의미적 검색이 필요한 모든 엔티티에 embedding 컬럼을 두거나, 별도 `ontology.embeddings` 테이블로 통합하는 것이 낫다.

#### 1-C. JSONB vs 정규화 컬럼 균형 — 개선 여지 있음

`projects.metadata JSONB`, `decisions.alternatives JSONB`, `plans.file_changes JSONB`, `plans.agent_assignment JSONB`가 JSONB로 되어 있다.

- `projects.metadata`: 적절. 프로젝트별 유연한 메타데이터.
- `decisions.alternatives`: 적절. 대안 목록의 구조가 결정마다 다를 수 있다.
- `plans.file_changes`: **부분적으로 부적절**. 파일 변경은 반복적으로 조회/집계할 데이터다. 별도 `ontology.plan_file_changes` 테이블로 정규화하면 "이 파일이 몇 번 변경 대상이 되었는지" 같은 쿼리가 가능해진다.
- `plans.agent_assignment`: `agent_spawns` 테이블과 중복 가능성 있음. 계획(plan) 단계의 할당과 실제(spawn) 실행을 분리하는 것은 좋지만, 두 테이블 간 연결(`plan_id` on `agent_spawns`)이 누락되어 있다.

#### 1-D. RLS 전략 — 현재 단계에서는 불필요, Phase 6에서 필수

문서에서 RLS(Row-Level Security)를 언급하지만 구현이 없다. 현재 개인 프로젝트이므로 RLS는 불필요하다. 그러나 Multi-Project(Phase 6)에서 `project_id` 기반 RLS를 적용하려면 다음이 필요하다:

```sql
-- Phase 6에서 추가
ALTER TABLE ontology.files ENABLE ROW LEVEL SECURITY;
CREATE POLICY files_project_isolation ON ontology.files
  USING (project_id = current_setting('app.current_project_id')::uuid);
```

현재는 RLS 없이 진행하고, Phase 6 진입 시 일괄 적용하는 것을 권장한다.

#### 1-E. View SQL 정확성 검증

**v_project_health**:
```sql
ROUND(AVG(s.tier_1_count::float / NULLIF(s.tier_1_count + s.tier_2_count + s.tier_3_count, 0)) * 100, 1) AS tier1_pct
```
- `NULLIF` 처리는 정확하다 (0으로 나누기 방지).
- 그러나 `tier_1_count`가 NULL인 세션이 있을 경우 전체 표현식이 NULL이 된다. `COALESCE`로 감싸야 안전하다.

**v_agent_effectiveness**:
```sql
ROUND(AVG(CASE WHEN asp.useful THEN 1 ELSE 0 END) * 100, 1) AS useful_pct
```
- `useful`이 NULL인 경우 ELSE 0으로 처리되어 "유용하지 않음"으로 집계된다. `CASE WHEN asp.useful = true THEN 1 WHEN asp.useful = false THEN 0 END`으로 NULL을 제외해야 정확하다.

**v_service_evolution**:
```sql
LEFT JOIN ontology.plans p ON p.signal_id = s.id
```
- signal 하나에 plan이 여러 개 생길 수 있다 (재계획). 이 경우 signal당 여러 행이 중복 집계된다. `DISTINCT ON` 또는 최신 plan만 조인하는 서브쿼리가 필요하다.

#### 1-F. 누락된 테이블/컬럼

1. **`ontology.embeddings` 통합 테이블 누락**: 현재 embedding이 `problems`와 `patterns`에만 인라인되어 있다. 모든 엔티티 타입에 대해 임베딩을 생성할 계획이라면 통합 테이블이 효율적이다.

2. **`agent_spawns.plan_id` 누락**: `plans` 테이블이 있지만 `agent_spawns`에서 어떤 plan에 의해 spawn되었는지 추적할 수 없다. Live Service(Phase 8) 파이프라인에서 필수적인 연결이다.

3. **`edges` 테이블의 `project_id` 누락**: edges가 어떤 프로젝트 컨텍스트에서 생성되었는지 추적할 수 없다. Multi-Project 격리에 필수.

4. **`conventions.project_id` FK 제약 누락**: `ON DELETE` 동작이 정의되지 않았다. `SET NULL`이 적절하다 (global convention이 되므로).

5. **인덱스 부족**:
   - `sessions(project_id, date)` — 프로젝트별 시계열 조회에 필수
   - `agent_spawns(session_id, agent_id)` — agent 효율 분석에 필수
   - `problems(project_id, severity)` — 프로젝트별 문제 조회
   - `signals(project_id, status, created_at)` — Live Service 대시보드

### 구체적 수정 제안

```sql
-- 1. edges 테이블에 project_id 추가
ALTER TABLE ontology.edges ADD COLUMN project_id UUID REFERENCES ontology.projects(id);
CREATE INDEX idx_edges_project ON ontology.edges(project_id);

-- 2. 통합 embeddings 테이블 (인라인 벡터 대체)
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

-- 3. agent_spawns와 plans 연결
ALTER TABLE ontology.agent_spawns ADD COLUMN plan_id UUID REFERENCES ontology.plans(id);

-- 4. 누락된 인덱스
CREATE INDEX idx_sessions_project_date ON ontology.sessions(project_id, date);
CREATE INDEX idx_spawns_session_agent ON ontology.agent_spawns(session_id, agent_id);
CREATE INDEX idx_problems_project_severity ON ontology.problems(project_id, severity);
CREATE INDEX idx_signals_project_status ON ontology.signals(project_id, status, created_at);

-- 5. v_agent_effectiveness NULL 수정
CREATE OR REPLACE VIEW ontology.v_agent_effectiveness AS
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

-- 6. v_service_evolution 중복 plan 문제 수정
CREATE OR REPLACE VIEW ontology.v_service_evolution AS
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
  ROUND(AVG(CASE WHEN p.human_approved AND p.approved_by = 'auto' THEN 1.0 ELSE 0.0 END) * 100, 1) AS auto_approval_pct,
  ROUND(AVG(d.error_rate_after - d.error_rate_before), 4) AS avg_error_delta,
  ROUND(AVG(EXTRACT(EPOCH FROM (s.resolved_at - s.created_at)) / 3600), 1) AS avg_resolution_hours
FROM ontology.signals s
LEFT JOIN latest_plans p ON p.signal_id = s.id
LEFT JOIN ontology.deployments d ON d.plan_id = p.id
GROUP BY DATE_TRUNC('week', s.created_at)
ORDER BY week;
```

---

## 2. 아키텍처 검증

### 타당한 결정

1. **PostgreSQL + pgvector로 그래프 모델링**: 현재 스케일(수천 노드, 수만 엣지 예상)에서 Neo4j는 과도하다. Supabase Cloud를 이미 운영 중이므로 추가 인프라 비용 $0은 올바른 판단이다. 학습 곡선도 SQL로 유지된다.

2. **Phase 순서의 점진적 복잡성 증가**: Phase 0(현재) → 1(추출) → 2(저장) → 3(임베딩) → 4(자동화) → 5(MCP) → 6(멀티 프로젝트) → 7(자율 진화) → 8(라이브 서비스). 각 Phase가 이전 Phase의 산출물에 의존하며, 단일 프로젝트(1-5)에서 멀티 프로젝트(6-7)로 확장하는 순서가 자연스럽다.

3. **MCP Server로 노출 (Phase 5)**: Claude Code의 MCP 프로토콜을 통해 GraphRAG를 네이티브 도구로 통합하는 것은 현재 워크플로우와 자연스럽게 연결된다. 별도 UI를 만들 필요가 없다.

### 위험 요소

#### 2-A. Recursive CTE의 실제 성능 한계

PostgreSQL에서 그래프 탐색을 recursive CTE로 구현할 때의 현실적 한계:

```sql
-- 3-hop 관계 탐색 예시
WITH RECURSIVE graph AS (
  SELECT source_id, target_id, relation, 1 AS depth
  FROM ontology.edges
  WHERE source_type = 'file' AND source_id = $1
  UNION ALL
  SELECT e.source_id, e.target_id, e.relation, g.depth + 1
  FROM ontology.edges e
  JOIN graph g ON e.source_id = g.target_id
  WHERE g.depth < 3
)
SELECT * FROM graph;
```

**성능 프로파일 (pgbench 기반 추정)**:
- 노드 1K, 엣지 5K, 3-hop: ~10ms (문제 없음)
- 노드 10K, 엣지 50K, 3-hop: ~100-500ms (허용 범위)
- 노드 100K, 엣지 500K, 3-hop: ~5-30초 (병목 시작)
- 노드 100K, 엣지 500K, 5-hop: 타임아웃 위험

**전환 시점**: 엣지 50K 초과 시 Neo4j 또는 Apache AGE(PostgreSQL graph extension) 평가를 권장한다. Apache AGE는 PostgreSQL 위에서 Cypher를 실행할 수 있어 마이그레이션 비용이 낮다.

#### 2-B. Supabase Cloud 무료 티어 실제 제약

| 리소스 | 무료 한도 | ontology 예상 사용량 | 여유 |
|--------|----------|---------------------|------|
| DB 크기 | 500MB | 기존 앱 ~50MB + ontology ~20MB (초기) | 충분 |
| pgvector 행 수 | 제한 없음 (크기만 제한) | ~5K vectors x 384d x 4byte = ~7.5MB | 충분 |
| Row 수 | 무제한 | 수만 행 | 충분 |
| Edge Functions 호출 | 500K/월 | GraphRAG 쿼리 ~1K/월 | 충분 |
| Realtime 연결 | 200 동시 | 미사용 | N/A |
| 대역폭 | 5GB/월 | 벡터 쿼리 결과 ~수 MB | 충분 |

**결론**: Phase 1-5까지 무료 티어로 충분하다. Phase 6(멀티 프로젝트)에서 DB 크기가 100MB를 넘기 시작하면 Pro 플랜($25/월) 전환을 고려해야 한다.

**주의**: Supabase 무료 티어는 1주간 비활성 시 프로젝트를 일시정지한다. 개인 프로젝트라도 정기적인 활성화가 필요하다.

#### 2-C. Phase 2의 JSON-LD → PostgreSQL 전환 불필요

로드맵에서 Phase 2 초기 저장소로 "JSON-LD flat file"을 추천하고 있으나, 이미 Supabase PostgreSQL이 운영 중이므로 **JSON-LD 단계를 건너뛰고 바로 PostgreSQL로 가는 것이 맞다**. JSON-LD를 거치면 마이그레이션 비용이 추가되고, Phase 3에서 어차피 pgvector가 필요해진다.

### 대안 제안

1. **Apache AGE 확장**: PostgreSQL에서 Cypher 쿼리를 사용할 수 있는 확장. Supabase Cloud에서 지원 여부를 확인해야 하지만, 자체 호스팅 전환 시 유력한 대안이다.

2. **Materialized View 활용**: 빈번한 그래프 탐색 패턴(예: "파일 → 관련 문제 → 해결책")을 Materialized View로 미리 계산하면 recursive CTE 비용을 줄일 수 있다.

```sql
CREATE MATERIALIZED VIEW ontology.mv_file_problems AS
SELECT
  f.id AS file_id, f.path,
  p.id AS problem_id, p.symptom, p.severity,
  s.id AS solution_id, s.description AS solution
FROM ontology.files f
JOIN ontology.edges e1 ON e1.source_type = 'file' AND e1.source_id = f.id AND e1.relation = 'CAUSED_BY'
JOIN ontology.problems p ON e1.target_type = 'problem' AND e1.target_id = p.id
LEFT JOIN ontology.solutions s ON s.problem_id = p.id AND s.verified = true;

-- 주기적 갱신 (세션 종료 시)
REFRESH MATERIALIZED VIEW CONCURRENTLY ontology.mv_file_problems;
```

---

## 3. Palantir 참조 정확도

### 정확한 매핑

| Palantir | Personal Palantir | 평가 |
|----------|-------------------|------|
| Foundry Ontology | PostgreSQL + pgvector | 정확. Foundry의 핵심인 "현실을 데이터로 1:1 매핑"이라는 철학을 올바르게 반영. |
| AIP (AI Platform) | Claude Code + Agent Orchestra | 정확. AIP의 LLM 기반 의사결정 + 실행을 Agent 시스템이 대체. |
| Contour (Analytics) | v_* SQL Views | 정확. 분석용 뷰 레이어. |
| Actions | Agent Pipeline | 정확. 자동 실행 파이프라인. |

### 수정 필요 매핑

1. **Data Integration Pipeline ≠ ".md + Git + PostHog + GitHub API"**: Palantir의 Data Integration은 **ETL/ELT 파이프라인**이다. 단순히 데이터 소스를 나열하는 것이 아니라, 소스에서 온톨로지로의 변환 로직(커넥터, 트랜스포머, 스케줄러)이 핵심이다. 로드맵에서 이 변환 파이프라인의 구체적 설계가 부족하다.

2. **Workshop ≠ Issue Template + Tier System**: Palantir Workshop은 **비개발자가 비즈니스 로직을 시각적으로 정의**하는 플랫폼이다. Issue Template과 Tier System은 워크플로우 정의 도구지만, "로우코드"라는 Workshop의 핵심 가치(비전문가 접근성)와는 거리가 있다. 이 매핑은 약간 과장되어 있다.

3. **OSDK ≠ MCP Server API**: Palantir OSDK는 **외부 애플리케이션이 온톨로지에 접근하는 SDK**다. MCP Server는 Claude Code라는 특정 클라이언트를 위한 인터페이스이므로 범용 SDK와는 다르다. 차라리 "OSDK 부분 대응"으로 표기하는 것이 정확하다.

### 누락 컨셉

1. **Data Lineage (데이터 계보)**: Palantir Foundry의 핵심 기능 중 하나로, 데이터가 어디서 왔고 어떤 변환을 거쳤는지 추적한다. 현재 로드맵에서 `edges` 테이블이 관계를 추적하지만, "이 Pattern 노드는 어떤 .md 파일의 어떤 섹션에서 추출되었고, 언제 마지막으로 갱신되었는지"라는 데이터 계보가 명시적이지 않다.

2. **Data Health / Quality Monitoring**: Foundry는 데이터 품질을 자동으로 모니터링한다 (스키마 드리프트, NULL 비율, 이상치 감지). 온톨로지 데이터의 "건강 상태"를 추적하는 메커니즘이 누락되어 있다. 예: "edges 중 dangling reference 비율", "embedding이 없는 노드 비율".

3. **Branching/Versioning**: Foundry는 데이터셋에 대한 브랜칭과 버전 관리를 지원한다. 온톨로지 스키마 변경이나 대규모 데이터 마이그레이션 시 "이전 상태로 롤백"하는 전략이 없다. Git처럼 스냅샷이나 버전을 관리하는 방안이 필요하다.

4. **Access Control Granularity**: Foundry는 온톨로지 객체 단위로 접근 제어를 한다. 현재 로드맵은 RLS를 `project_id` 레벨로만 설계했는데, Phase 7-8에서 "특정 Convention은 수정 금지" 같은 세밀한 제어가 필요할 수 있다.

---

## 4. 회고 데이터 파이프라인

### 데이터 흐름 설계

로드맵에서 "Daily/Weekly Retrospective가 GraphRAG의 최우선 입력"이라는 전제는 **조건부로 타당**하다.

**타당한 이유**: 회고 데이터는 다음을 포함한다:
- 작업 세션별 메트릭 (토큰 사용량, Tier 분포, agent spawn 횟수)
- 성공/실패 패턴 (PM 승인률, 재작업 횟수)
- 정책 위반 기록 (Convention violation)
- 문제-해결 쌍의 누적

**한계**: 그러나 회고 데이터만으로는 GraphRAG의 입력이 부족하다. 실제로 가장 풍부한 시그널은:

1. **Git 커밋/diff 히스토리** (코드 수준의 변경 추적, co-change 패턴)
2. **GitHub Issues/PR 데이터** (결정 컨텍스트, 논의 이력)
3. **코드 AST 분석** (import 관계, 함수 호출 그래프)

회고 데이터는 이것들을 **해석하고 맥락을 부여하는** 메타 레이어로서 가치가 있다. 단독으로 "최우선 입력"이라기보다는 "최우선 메타데이터 소스"로 보는 것이 정확하다.

### ETL 구현 제안

현재 `memory/retrospective.md`가 존재하지 않는 상태이므로, 파이프라인 설계를 먼저 제안한다.

```
[Phase A: 데이터 수집]

1. Git History Collector
   git log --format=json → Session 노드 생성
   git diff --stat       → MODIFIED_IN 엣지 생성
   co-change frequency   → RELATED_TO 엣지 (weight = 동시변경 횟수/전체)

2. GitHub API Collector  
   GET /repos/{owner}/{repo}/issues → Issue 노드
   GET /repos/{owner}/{repo}/pulls  → Session에 PR 연결
   Comments/Reviews                 → Decision 노드 후보

3. Memory File Parser (.md → structured data)
   troubleshooting.md → Problem + Solution 노드
   architecture.md    → Decision 노드
   DELEGATION.md      → Convention 노드
   delegation-metrics.md → Metric 노드 (현재 비어있음)

4. Code Analysis (AST)
   import/export 분석  → DEPENDS_ON 엣지
   파일 소유권 매핑    → Agent OWNS File 엣지

[Phase B: 변환]

Claude API를 사용한 엔티티/관계 추출:
  Input:  .md 청크 또는 커밋 메시지
  Prompt: "다음 텍스트에서 엔티티(Problem, Decision, Pattern, Convention)와
           관계(RESOLVED_BY, CAUSED_BY, USES_PATTERN)를 JSON으로 추출하라"
  Output: {entities: [...], relations: [...]}

변환 규칙:
  - Issue #XX 패턴 → Issue 노드 자동 생성 + DEPENDS_ON 엣지
  - 파일 경로 패턴 → File 노드 자동 생성 + MODIFIED_IN 엣지
  - "문제: ... → 해결: ..." 패턴 → Problem + Solution 노드 쌍

[Phase C: 적재]

Supabase Client (TypeScript) 또는 Edge Function:
  1. Upsert 엔티티 (중복 방지: UNIQUE 제약)
  2. Upsert 엣지 (UNIQUE(source_type, source_id, target_type, target_id, relation))
  3. 임베딩 생성 → embeddings 테이블 INSERT
  4. Materialized View REFRESH
```

### 핵심 메트릭 우선순위

가장 가치있는 시그널을 1순위부터 정렬한다:

| 순위 | 메트릭 | 왜 가치있는가 | 수집 난이도 |
|------|--------|-------------|-----------|
| 1 | **PM 재작업률** | agent 품질의 직접 지표. 이 수치가 낮을수록 시스템이 성숙 | 낮음 (agent_spawns.result) |
| 2 | **Tier 오판률** | 위임 정책의 정확도. Tier 2로 시작했는데 Tier 3이 된 비율 | 중간 (수동 기록 필요) |
| 3 | **파일별 문제 발생 빈도** | "이 파일을 건드리면 항상 문제가 생긴다" → 리팩토링 우선순위 | 낮음 (edges + problems) |
| 4 | **컨텍스트 적중률** | agent에게 제공한 컨텍스트 중 실제 사용된 비율 | 높음 (agent 출력 분석 필요) |
| 5 | **세션당 토큰 효율** | 동일 Tier 작업의 토큰 추이 → 시스템 학습 곡선 | 낮음 (sessions.total_tokens) |
| 6 | **Convention 위반-실패 상관** | 규칙을 어겼을 때 실패하는 비율 → 규칙의 실제 가치 | 중간 (위반 추적 필요) |
| 7 | **패턴 재사용률** | 등록된 패턴 중 실제로 참조/적용된 비율 | 중간 (edges 분석) |

---

## 5. 실현 가능성 매트릭스

| Phase | 난이도 | 현실적 기간 (1인+AI) | 핵심 리스크 | 비고 |
|-------|--------|---------------------|-----------|------|
| **1: Entity Extraction** | 중 | 2-3주 | NLP 정확도. .md 파일의 비정형 구조에서 엔티티 추출 정확도가 낮을 수 있음 | Claude API로 추출하면 정확도 높지만 비용 발생 ($0.5-2/추출) |
| **2: Storage & Query** | 낮 | 1-2주 | 없음. 기존 Supabase에 CREATE TABLE 실행하면 끝. JSON-LD 단계는 건너뛸 것 | 가장 쉬운 Phase |
| **3: Embedding & Search** | 중 | 2-3주 | 로컬 모델(all-MiniLM) 실행 환경. 또는 OpenAI API 비용. pgvector 인덱스 튜닝 | sentence-transformers를 로컬에서 돌리면 비용 $0 |
| **4: Agent Integration** | **높** | **4-6주** | Auto context assembly의 정확도가 핵심. "어떤 컨텍스트가 필요한지" 판단 로직이 시스템의 가치를 결정 | **가장 어려운 Phase**. Feedback loop의 자동화 수준이 전체 로드맵의 성패를 좌우 |
| **5: MCP Server** | 중 | 2-3주 | MCP 프로토콜 구현. TypeScript MCP SDK 사용 시 비교적 단순 | Phase 4의 로직을 MCP 인터페이스로 감싸는 작업 |
| **6: Multi-Project** | 높 | 6-8주 | 두 번째 프로젝트가 없으면 검증 불가. 패턴 승격 로직의 임계값 튜닝 | 실제 두 번째 프로젝트가 있어야 의미 있음 |
| **7: Self-Evolving** | **최상** | **8-12주** | 자율 최적화의 안전성. 잘못된 정책 자동 적용 시 복구 어려움. A/B 테스트 프레임워크 자체가 복잡 | **현실적으로 Phase 7 MVP는 "제안만 하고 인간이 적용"하는 수준으로 축소 필요** |
| **8: Live Service** | 높 | 4-6주 MVP + ongoing | Signal detection의 노이즈 필터링. Canary deploy 자동화. 야간/주말 자동 실행의 안전성 | Phase 7의 축소 버전으로 시작 가능 |

**총 현실적 기간: 30-44주 (문서의 16-26주 대비 약 1.7배)**

문서의 기간 추정은 낙관적이다. 특히:
- Phase 4는 2-3주가 아니라 4-6주 소요. "자동 컨텍스트 어셈블리"가 정확하려면 상당한 시행착오가 필요하다.
- Phase 7은 4-6주가 아니라 8-12주. "자율 진화"는 이름만 들어도 복잡하다. MVP 스코프를 대폭 축소해야 한다.
- Phase 6은 두 번째 프로젝트 없이는 검증이 불가능하다. 실제 프로젝트 착수 시점에 맞춰야 한다.

**기존 도구로 실현 가능한 범위**:
- **Claude Code MCP**: Phase 5의 MCP Server 구현은 TypeScript MCP SDK(`@modelcontextprotocol/sdk`)로 가능. 현재 Claude Code가 MCP 서버를 잘 지원한다.
- **Supabase**: Phase 1-3의 저장소로 충분. pgvector 포함.
- **Claude API**: Phase 1의 엔티티 추출, Phase 4의 컨텍스트 어셈블리에 사용 가능. 비용은 월 $5-20 수준.

---

## 6. 업계 참고 사례

### 유사 접근법

#### Microsoft GraphRAG (2024)
- **논문**: "From Local to Global: A Graph RAG Approach to Query-Focused Summarization"
- **접근**: LLM으로 텍스트에서 엔티티/관계를 추출 → 커뮤니티 감지(Leiden algorithm) → 커뮤니티 요약 → 글로벌 질문에 답변
- **참고 포인트**: 로드맵의 Phase 1(Entity Extraction)과 Phase 3(Embedding)에 직접 적용 가능. 특히 커뮤니티 감지를 통한 "관련 노드 클러스터링"은 Auto Context Assembly(Phase 4)의 정확도를 높일 수 있다.
- **차이점**: Microsoft GraphRAG는 정적 문서 코퍼스 대상. 이 로드맵은 코드+운영 데이터가 실시간으로 변하는 동적 그래프.

#### Cursor / Codebase Indexing
- **접근**: 코드베이스를 임베딩하여 벡터 인덱스 생성 → 쿼리 시 관련 코드 청크 검색 → LLM 컨텍스트로 주입
- **한계**: 그래프 관계가 없음. 순수 벡터 검색이므로 "이 파일을 변경하면 영향받는 파일"같은 구조적 질문에 약하다.
- **참고 포인트**: 임베딩 파이프라인과 청킹 전략은 참고할 만하다.

#### Devin (Cognition)
- **접근**: 에이전트가 코드베이스 전체를 탐색하며 작업 수행. 브라우저+터미널+에디터를 동시 사용.
- **한계**: 세션 간 학습 없음. 매번 처음부터 탐색.
- **참고 포인트**: 이 로드맵의 Phase 4(Agent Integration)와 Phase 8(Live Service)은 Devin의 "에이전트 자율 실행"을 세션 간 학습이 누적되는 형태로 발전시킨 것이다.

#### Obsidian / Roam Research (PKM)
- **접근**: 문서 간 양방향 링크로 지식 그래프 형성. 그래프 뷰 시각화.
- **한계**: 수동 링크 생성. 자동 엔티티 추출이나 코드 분석이 없음.
- **참고 포인트**: "Backlink" 개념은 `edges` 테이블의 양방향 조회와 유사. 그러나 이 로드맵은 자동 추출 + 코드 분석이라는 점에서 PKM을 넘어선다.

#### Notion AI / Notion Databases
- **접근**: 구조화된 데이터베이스 + AI 요약/검색
- **한계**: 코드 인식 없음. 개발 워크플로우 통합 없음.
- **차별점**: 이 로드맵은 개발 프로세스 자체를 온톨로지로 모델링한다는 점에서 근본적으로 다르다.

### 차별화 포인트

1. **코드+프로세스 통합 온톨로지**: 기존 도구들은 코드(Cursor) 또는 프로세스(Notion)를 별개로 다룬다. 이 시스템은 코드 구조, 개발 프로세스, 의사결정 이력, 에이전트 행동을 하나의 그래프로 통합한다.

2. **폐쇄 루프 학습**: Palantir조차 "분석 → 인사이트 → 인간이 실행"에서 끝나지만, 이 시스템은 "분석 → 인사이트 → 에이전트 실행 → 결과 피드백 → 그래프 업데이트"까지 자동화한다.

3. **크로스 프로젝트 지식 전이**: 대부분의 개발 도구는 단일 프로젝트에 귀속된다. Meta Graph를 통한 프로젝트 간 학습 전이는 독창적이다.

### 참고할 논문/프로젝트

| 이름 | 유형 | 관련 Phase | 핵심 참고 포인트 |
|------|------|-----------|----------------|
| Microsoft GraphRAG | 논문+OSS | Phase 1, 3 | 엔티티 추출, 커뮤니티 감지, 글로벌 요약 |
| LlamaIndex Knowledge Graph | 라이브러리 | Phase 1, 2 | KG 기반 RAG 파이프라인 구현 패턴 |
| LangGraph | 프레임워크 | Phase 4, 7 | 상태 기반 에이전트 그래프 오케스트레이션 |
| MemGPT / Letta | 논문+OSS | Phase 7 | LLM의 장기 기억 관리, 자동 메모리 계층 |
| AutoGen (Microsoft) | 프레임워크 | Phase 4, 8 | 다중 에이전트 대화 패턴, 피드백 루프 |
| ReAct Pattern | 논문 | Phase 4 | Reasoning + Acting 루프 |
| "Building Knowledge Graphs from Text" (Stanford) | 강의 | Phase 1 | 텍스트→KG 변환 방법론 |

---

## 7. 최종 권고 사항

### 즉시 수정 (Critical)

1. **edges 테이블에 `project_id` 컬럼 추가**: Multi-Project 격리의 기본 전제. 이것 없이 Phase 6 진입 불가.

2. **View SQL의 NULL 처리 수정**: `v_agent_effectiveness`의 `useful` NULL 문제, `v_service_evolution`의 plan 중복 문제. 잘못된 집계는 잘못된 의사결정으로 이어진다.

3. **Phase 2에서 JSON-LD 단계 제거**: 이미 PostgreSQL이 있으므로 불필요한 중간 단계. Phase 1의 산출물을 바로 PostgreSQL에 적재해야 한다.

4. **`agent_spawns`에 `plan_id` FK 추가**: Phase 8(Live Service)에서 계획-실행-결과를 추적하는 핵심 연결고리.

5. **Timeline 현실화**: 16-26주 → 30-44주로 조정. 특히 Phase 4(4-6주)와 Phase 7(8-12주) 재추정. 낙관적 일정은 중간에 좌절감을 준다.

### 중기 개선 (Important)

6. **통합 embeddings 테이블 도입**: 현재 `problems`와 `patterns`에만 인라인된 vector 컬럼을 별도 테이블로 통합. 일관된 벡터 검색 API를 가능하게 한다.

7. **Data Lineage 추적 추가**: 각 온톨로지 노드가 "어떤 원본 소스에서 추출되었는지" 추적하는 메커니즘. `edges`에 `EXTRACTED_FROM` 관계를 추가하거나, 각 노드에 `source_ref` 컬럼 추가.

8. **Phase 7 스코프 대폭 축소**: "Self-Evolving"이라는 이름은 유지하되, MVP는 "메트릭 기반 제안 생성 → 인간 승인 → 수동 적용"으로 한정. 자동 적용은 Phase 7.1로 분리.

9. **retrospective.md 구조 정의**: 현재 파일이 존재하지 않는다. GraphRAG의 "최우선 입력"이라면 즉시 구조를 정의하고 데이터 수집을 시작해야 한다. 제안 구조:
   ```markdown
   ## YYYY-MM-DD (Session N)
   ### Metrics
   - Tier: 1(X) 2(Y) 3(Z)
   - Tokens: ~NK
   - Agents: [list]
   - PM Result: APPROVED/REJECTED
   ### Patterns Discovered
   ### Problems Encountered
   ### Decisions Made
   ```

10. **누락 인덱스 일괄 추가**: `sessions(project_id, date)`, `agent_spawns(session_id, agent_id)`, `problems(project_id, severity)`, `signals(project_id, status, created_at)`.

### 장기 검토 (Nice to have)

11. **Apache AGE 평가**: 엣지 50K+ 시점에서 Cypher 쿼리 지원 여부 확인. PostgreSQL 위에서 동작하므로 마이그레이션 비용이 낮다.

12. **Materialized View 전략**: 빈번한 그래프 탐색 패턴(file → problems → solutions)을 Materialized View로 선계산.

13. **Improvement Velocity Formula 검증**: `V(n) = V(1) * (1 + learning_rate)^n`은 지수 성장을 가정하지만, 실제로는 로그 성장에 가깝다. `V(n) = V(1) * (1 + learning_rate * log(n))` 또는 수렴하는 함수가 더 현실적이다.

14. **Palantir Workshop 대응 재설계**: 현재 "Issue Template + Tier System"이라는 대응은 약하다. 실제로 비개발자(또는 AI)가 워크플로우를 정의할 수 있는 인터페이스가 필요하다면, YAML 기반 워크플로우 정의 파일 또는 간단한 웹 UI를 고려.

15. **비용 모니터링**: Phase 4부터 Claude API 호출이 증가한다. 월간 API 비용을 추적하는 메트릭을 `ontology.metrics`에 포함시킬 것. 예산 초과 시 자동 알림.

---

## 부록: Phase 우선순위 재편 제안

현재 로드맵은 Phase 1-8이 순차적이지만, 일부 Phase는 병렬화 가능하다:

```
Phase 1 (Entity Extraction) ──→ Phase 2 (Storage) ──→ Phase 3 (Embedding)
                                                            │
Phase 0.5 (retrospective.md 구조화) ─────────────────────────┘
                                                            │
                                              Phase 4 (Agent Integration)
                                                            │
                                              Phase 5 (MCP Server)
                                                            │
                                    ┌─── Phase 6 (Multi-Project) ← 두 번째 프로젝트 착수 시
                                    │
                                    └─── Phase 7-lite (제안만 생성)
                                                │
                                    Phase 8-lite (Signal Detection + 수동 실행)
```

Phase 6는 두 번째 프로젝트가 실제로 시작될 때까지 보류하고, Phase 7/8의 축소 버전을 먼저 구현하는 것이 현실적이다. "멀티 프로젝트 지식 전이"는 하나의 프로젝트만으로는 검증 불가능하기 때문이다.
