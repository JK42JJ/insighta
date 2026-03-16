---
allowed-tools: Bash(git:*), Bash(gh:*), Bash(tail:*), Bash(wc:*), Bash(tmux:*), Read, Grep, Glob, Agent, CronCreate, CronList
description: Session boot — load all project context, resume last checkpoint, show status and relevant warnings
---

## Context
- Branch: !`git branch --show-current`
- Status: !`git status --short`

## Instructions

세션 시작 시 프로젝트 맥락을 완전히 복원한다. CLAUDE.md Boot Sequence를 자동화한 것.

$ARGUMENTS로 도메인 힌트를 줄 수 있다: `/boot frontend`, `/boot infra`, `/boot supabase`, `/boot graphrag`
힌트가 없으면 현재 브랜치명과 최근 커밋에서 도메인을 자동 감지한다.

### Phase 1: Core Context Load (필수, 병렬 실행)

아래 파일들을 **반드시** Read 도구로 읽는다. 하나도 빠뜨리면 안 된다.

```
Read: ~/.claude/projects/-Users-jeonhokim-cursor-insighta/memory/MEMORY.md
Read: ~/.claude/projects/-Users-jeonhokim-cursor-insighta/memory/credentials.md
Read: ~/.claude/projects/-Users-jeonhokim-cursor-insighta/memory/troubleshooting.md
Read: ~/.claude/projects/-Users-jeonhokim-cursor-insighta/memory/project-structure.md
Read: docs/operations-manual.md
```

### Phase 2: Domain Detection & Load

**도메인 감지 로직** (우선순위순):
1. $ARGUMENTS에 명시적 도메인 힌트가 있으면 그것을 사용
2. 없으면 브랜치명에서 감지:
   - `story/6[5-9]` 또는 `design` → frontend
   - `story/7[0-3]` 또는 `animation|motion|dnd` → frontend
   - `story/7[4-7]` 또는 `dashboard|widget` → frontend
   - `story/5[5-9]` 또는 `fsd|component` → frontend
   - `story/6[0-4]` 또는 `crud|api|tier` → backend
   - `story/7[8-80]` 또는 `entity|adapter` → architecture
   - `story/8[1-4]` 또는 `perf|a11y|offline|cdn` → performance
   - `graphrag|rag|knowledge` → graphrag
   - `infra|deploy|ci|terraform` → infra
   - `supabase|edge` → supabase
3. 감지 실패 시 → general (추가 로드 없음)

**도메인별 추가 Read**:

| 도메인 | 추가로 읽을 파일 |
|--------|----------------|
| frontend | memory/ux-issues.md, memory/architecture.md |
| backend | memory/architecture.md, memory/infrastructure.md |
| architecture | memory/architecture.md |
| performance | memory/architecture.md, memory/ux-issues.md |
| graphrag | memory/architecture.md, docs/graph-rag-roadmap.md |
| infra | memory/infrastructure.md, memory/project-structure.md |
| supabase | memory/infrastructure.md, memory/project-structure.md |

### Phase 3: Checkpoint Resume (병렬 실행)

checkpoint.md는 누적 파일이라 크기가 클 수 있다. **절대 전체 Read하지 않는다.**

```bash
tail -100 ~/.claude/projects/-Users-jeonhokim-cursor-insighta/memory/checkpoint.md
```

이 Bash 출력에서:
1. 마지막 Checkpoint 항목을 찾아 **이전 작업 내용** 파악
2. Pending Work 섹션이 있으면 미완료 작업 확인

### Phase 4: Status Dashboard (병렬 실행)

```bash
git log --oneline -5
git diff --stat
gh issue list --state open --label story --json number,title,labels --jq '.[] | "#\(.number): \(.title)"'
gh run list --limit 2 --json status,conclusion,name,createdAt
gh pr list --json number,title,state
tmux list-panes -t tubearchive -F '#{pane_index}: #{pane_width}x#{pane_height} #{pane_current_command}' 2>/dev/null || echo "tmux: not in session"
```

**tmux 대시보드 내용 확인**: pane이 3개 이상이면, 각 대시보드의 **실제 출력 내용**을 캡처한다.

```bash
# Agent Dashboard (pane 1) — 최근 40줄
tmux capture-pane -t tubearchive:1.2 -p -S -40 2>/dev/null || echo "agent-dashboard: capture failed"
# Ops Dashboard (pane 2) — 최근 40줄
tmux capture-pane -t tubearchive:1.3 -p -S -40 2>/dev/null || echo "ops-dashboard: capture failed"
```

**대시보드 내용 해석**:
- 정상 구성: pane 1 (좌측: Claude), pane 2 (우측 상단: Agent Dashboard), pane 3 (우측 하단: Ops Dashboard)
- pane이 3개 미만이면 경고 출력 — 대시보드가 누락된 상태

**Agent Dashboard에서 추출할 정보** (pane 1):
- TEAM: 활성 에이전트 목록, 현재 작업 상태
- MAIN SESSION: Claude 세션 상태
- FILE CHANGES: 변경된 파일 수, 최근 수정
- AGENTS: 서브에이전트 실행 현황

**Ops Dashboard에서 추출할 정보** (pane 2):
- HEALTH: 서비스 상태 (dev v1 :8081, dev v2 :8082, prod)
- GIT: 브랜치/커밋 상태
- DEPLOYS: 최근 배포 상태 (prod v1, prod v2)
- CI/WORKFLOWS: GitHub Actions 상태
- PRs/ISSUES: 오픈 PR, 이슈 수
- SUPABASE: DB 연결, Edge Functions 상태
- INFRA: EC2, Terraform 상태

### Phase 5: Troubleshooting Awareness (Regression Prevention 포함)

troubleshooting.md에서 **현재 도메인과 관련된 경고**를 추출한다:
- frontend → "카드", "D&D", "toast", "optimistic", "cache", "v1/v2" 관련
- backend → "Prisma", "PgBouncer", "DATABASE_URL" 관련
- supabase → "Edge Function", "--no-verify-jwt", "main/index.ts" 관련
- infra → "EC2", "GHCR", "SSH", "deploy" 관련
- 모든 도메인 → "반복되는 실수 방지 체크리스트" 섹션 항상 포함

**Regression Prevention (LEVEL-2+ 패턴)**:

troubleshooting.md의 "Regression Watchlist (LEVEL-2+)" 섹션에서 LEVEL-2 이상 패턴을 필터링한다.
해당 패턴이 있으면 아래 형식으로 Pre-flight Checklist를 출력한다:

```
### Pre-flight Checks (Regression Prevention)
⚠️ LEVEL-{N} Pattern: {패턴명} (recurrence: {N}회)
- [ ] {구체적 확인 항목 1}
- [ ] {구체적 확인 항목 2}
- [ ] {구체적 확인 항목 3}
→ 이 체크리스트를 확인했음을 선언한 후 작업을 시작한다.
```

LEVEL-3 패턴은 CLAUDE.md에도 hard rule로 등재되어 있으므로, 해당 작업 시 반드시 유저 확인 후 진행한다.

### Phase 6: Learning Review (자기개선 사이클의 Read 단계)

최근 checkpoint의 `교훈` 필드를 검토하여, 이번 세션에 적용할 인사이트를 추출한다.

**6a. 최근 교훈 적용 확인**:
checkpoint.md의 마지막 2-3개 checkpoint에서 `교훈` 필드를 확인:
- 이번 세션의 도메인과 관련된 교훈이 있으면 Warnings에 포함
- 예: 이전 checkpoint에서 "v1/v2 혼동 주의" 교훈 → frontend 도메인 boot 시 경고

**6a-2. Improvement Target 즉시 실행**:
session-log.md 마지막 행의 "Improvement Target" 확인:
```
Read: ~/.claude/projects/-Users-jeonhokim-cursor-insighta/memory/session-log.md
```
- 타겟이 "—"가 아니면:
  1. 5분 내 실행 가능한 액션이면 **Phase 6 내에서 즉시 실행** (리마인드가 아님)
  2. 실행 후 Warnings에 "Previous target: {내용} → **DONE**" 표시
  3. 실행 불가능한 타겟이면 Warnings에 "Previous target: {내용} — 이번 세션에서 기회 시 적용" 표시
- 이 변경의 이유: D3 적용률 40%→개선 목표. 리마인드만으로는 코드 작업에 밀려 미적용됨

**6a-3. Open Requests 확인**:
request-journal.md에서 `wip`/`noted` 상태 항목을 필터링한다:
```bash
grep -E '\| (wip|noted) \|' ~/.claude/projects/-Users-jeonhokim-cursor-insighta/memory/request-journal.md
```
- `wip`/`noted` 항목이 있으면 Output Format의 "Open Requests" 섹션에 표시
- 없으면 해당 섹션 생략

**6b. Memory 품질 점검** (빠르게, 출력 3줄 이내):
- MEMORY.md 줄 수 확인 (`wc -l`): 180줄 이상이면 "WARN: approaching limit" 경고
- troubleshooting.md의 "반복 실수 체크리스트"에서 체크 안 된 항목 수 확인
- 마지막 checkpoint의 Pending Work에서 **7일 이상 미완료** 항목 경고

**6c. Eval 이력 확인 (Regression Awareness 포함)**:
- `eval-scores.md`를 Read (Scoring Guide v3 + Epoch Log 테이블)
- 최근 3 epoch의 Eval 평균 계산 → 트렌드 (상승/정체/하락)
- **가장 낮은 Dimension** 식별 → 이번 세션에서 집중 개선 대상으로 Warnings에 포함
- 예: D2(Error Prevention)가 최저 → "이번 세션: troubleshooting.md 패턴 재발 주의"
- Eval이 0.8+ 안정 → "Eval 체계 세분화 검토 권장" 알림
- **LEVEL-2+ 패턴 수** 표시 (troubleshooting.md Regression Watchlist 기반)
- **D2 volatile 여부** 경고 (최근 3 epoch에서 변동폭 > 0.5이면 "D2 VOLATILE — 특별 주의")
- "이번 세션 D2 목표: {구체적 행동}" 출력 (예: "DB 작업 시 Pre-flight Checklist 확인 후 진행")

**6d. Memory 개선 이력 확인**:
- `retrospective.md`의 "Rule Evolution Log" 마지막 항목 확인
- 최근 승격/진화가 30일 이상 없으면: "NOTE: /retrospective 실행 권장" 출력

### Phase 7: Scheduled Jobs (자동 등록)

`CronList`로 현재 등록된 cron job 확인 후, 아래 목록에서 미등록된 것만 `CronCreate`로 등록:

| Job | Cron | 주기 | 비고 |
|-----|------|------|------|
| `/retrospective` | `3 17 * * *` | 매일 17:03 | 일일 회고 |
| `/sync-docs` | `0 0 */7 * *` | 7일마다 자정 | 산출물 현행화 (Wiki, README, MEMORY) |

**등록 로직** (각 job에 대해):
1. `CronList` 결과에서 해당 prompt가 포함된 job 검색
2. **없으면** → `CronCreate`로 등록 (recurring: true)
3. **있으면** → 스킵, 출력에 "already scheduled" 표시

**출력 형식** (Output Format의 Ready 섹션 위에 추가):
```
### Scheduled Jobs
- /retrospective: {17:03 daily — registered | already scheduled | failed: {reason}}
- /sync-docs: {weekly (7d) — registered | already scheduled | failed: {reason}}
```

**참고**: CronCreate는 세션 전용 (3일 자동 만료). `/boot` 실행 시마다 재등록하므로 문제없음.

### Output Format

아래 형식으로 출력한다. 간결하게.

```
## Session Boot Complete

**Branch**: {branch} | **Domain**: {detected domain}
**Last Checkpoint**: #{N} — {title} ({date})

### Recent Work
- {마지막 checkpoint 핵심 내용 2-3줄}
- {pending work가 있으면 표시}

### Git Status
- Last 3 commits: {oneline}
- Uncommitted: {count} files
- Open PRs: {list or "none"}

### Open Stories ({count})
{story 목록 — 현재 도메인 관련만 필터링}

### CI Status
{최근 2건}

### tmux Environment
- Panes: {count}/3 | {정상이면 "OK", 미달이면 "WARN: dashboard missing"}

**Agent Dashboard** (pane 1):
- Status: {running/stopped}
- Active Agents: {에이전트 목록 또는 "none"}
- File Changes: {변경 파일 수}
- Session: {Claude 세션 상태}

**Ops Dashboard** (pane 2):
- Status: {running/stopped}
- Health: dev v1 (:8081) {up/down} | dev v2 (:8082) {up/down} | prod {up/down}
- Deploy: {최근 배포 상태 — prod v1/v2 구분}
- CI: {최근 workflow 상태}
- Supabase: {DB/Edge Functions 상태}
- Open: {PRs 수}개 PR, {Issues 수}개 Issue

### Pre-flight Checks (Regression Prevention)
{LEVEL-2+ 패턴이 있으면 Phase 5의 형식대로 출력}
{없으면 이 섹션 생략}

### Warnings (from troubleshooting.md)
- {현재 도메인 관련 경고 1-3개}
- {반복 실수 체크리스트에서 관련 항목}

### Open Requests (Phase 6a-3)
{wip/noted 항목 테이블 — request-journal.md에서 필터}
(항목 없으면 이 섹션 생략)

### Improvement Target (Phase 6a-2)
- Previous target: {session-log 마지막 행의 Improvement Target}
(타겟이 "—"이면 이 섹션 생략)

### Lessons from Recent Sessions (Phase 6a)
- {최근 checkpoint 교훈 중 이번 도메인 관련 1-2개}
- {7일+ 미완료 Pending Work 경고 (있으면)}
(교훈 없으면 이 섹션 생략)

### Eval Trend (Phase 6c)
- Recent Epochs: {최근 3개 Epoch Eval 점수 나열}
- Trend: {상승/정체/하락} | Avg: {3-epoch 이동 평균}
- Weakest: D{N} ({이름}) — {이번 세션 집중 개선 대상}
- Regression Watchlist: {LEVEL-2+ 패턴 수}개 active
- {D2 volatile 여부: 변동폭 > 0.5이면 "D2 VOLATILE — 특별 주의" 출력}
- D2 목표: {이번 세션에서 취할 구체적 행동}
(eval-scores.md에 Epoch 기록이 없으면 "No eval data yet" 출력)

### Scheduled Jobs
- /retrospective: {17:03 daily — registered | already scheduled | failed: {reason}}
- /sync-docs: {weekly (7d) — registered | already scheduled | failed: {reason}}

### Memory Health
- MEMORY.md: {줄 수}/200 {180+ 이면 "WARN: trim needed"}
- Last /retrospective: {날짜} {30일+ 이면 "NOTE: 실행 권장"}

### Ready
도메인 [{domain}] 컨텍스트 로드 완료. 작업 지시를 기다린다.
```

### 주의사항

- credentials.md의 시크릿 값을 출력에 포함하지 않는다 (읽기만 하고 기억만 유지)
- 파일 Read 실패 시 경고만 출력하고 계속 진행한다
- **병렬 실행 전략**: Phase 1~2는 한 batch (모두 Read), Phase 3~4는 다음 batch (모두 Bash), Phase 5~6은 분석만 (추가 I/O 없음). Read와 Bash를 같은 batch에 섞지 않는다.
- 이 command의 목적은 **맥락 복원 + 교훈 적용**이다. 코드를 수정하거나 새 작업을 시작하지 않는다

### 자기개선 사이클 요약

```
/checkpoint (Write)          /boot (Read)                  /retrospective (Analyze)
    │                            │                              │
    ├── Step 1-2: 작업 기록       ├── Phase 1-4: 맥락 복원        ├── session-log 분석
    ├── Step 2a: session-log 행   ├── Phase 5: 실수 경고          ├── 에러 패턴 발견
    ├── Step 3: 교훈 추출         ├── Phase 6a: 교훈 적용         ├── 효율 트렌드
    ├── Step 6: Eval (2자리)      ├── Phase 6a-2: Target 리마인드  ├── 개선 제안 생성
    ├── Improvement Target 도출   ├── Phase 6c: Eval 로드         └── 유저 승인 → 규칙 반영
    └── session-log 행 추가       └── Phase 6d: 개선 이력
         │                            │
         └──── 데이터 축적 ───────────┘
              Improvement Target → 다음 세션 리마인드 → 적용 확인
```
