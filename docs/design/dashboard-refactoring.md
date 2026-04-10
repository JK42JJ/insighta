# Dashboard v2 Design — Workflow-Centric Redesign (#330)

> **Pain Point**: Claude Code가 뭘 하는지 모르겠다 → 작업 미스 반복.
> **Root Cause**: 현재 대시보드가 **데이터 소스별** (git, supabase, agents) 배치. 개발자의 **워크플로우 순서**와 무관.
> **Goal**: Insighta 워크플로우 단계에 맞춰 정보를 재구성. "지금 뭐 해야 하지?" → 대시보드 한 눈에 답.

---

## 1. Insighta 워크플로우 → 대시보드 매핑

```
┌──────────────────────────────────────────────────────────┐
│  /init → /work → Code → /check → /ship → /save → /retro │
│    ①       ②      ③       ④        ⑤       ⑥       ⑦    │
└──────────────────────────────────────────────────────────┘
```

| 단계 | 개발자 질문 | 필요 정보 | 현재 대시보드 |
|------|-----------|----------|-------------|
| ① /init | "이전에 뭐 했지?" | 마지막 CP, pending work | ❌ 없음 |
| ② /work | "뭘 해야 하지?" | open issues, 우선순위 | △ ISSUES (목록만) |
| ③ Code | "Claude가 지금 뭘 하고 있지?" | **현재 파일, 도구, 진행률** | △ tool count만 |
| ④ /check | "빌드 됐나? 테스트 통과?" | tsc, lint, test 결과 | ❌ 없음 |
| ⑤ /ship | "배포 어디까지 갔지?" | CI pipeline, deploy 상태 | △ DEPLOY (추상적) |
| ⑥ /save | "기록 잘 됐나?" | CP 번호, memory 상태 | ❌ 없음 |
| ⑦ Always | "시스템 정상이야?" | health, DB, API 서버 | ○ 있지만 임계값 없음 |

**핵심 발견**: 가장 오래 머무는 ③ Code 단계 정보가 가장 부실.

---

## 2. 새 대시보드 레이아웃

### tmux 3-pane 구조 (기존 유지)
```
┌─────────────────────────┬────────────────────────┐
│                         │   WORK DASHBOARD       │
│                         │   (agent-dashboard.sh)  │
│   Claude Code CLI       │   "지금 뭘 하고 있나"    │
│   (pane 0)              ├────────────────────────┤
│                         │   SYSTEM DASHBOARD     │
│                         │   (ops-dashboard.sh)    │
│                         │   "시스템 괜찮은가"       │
└─────────────────────────┴────────────────────────┘
```

---

## 3. WORK DASHBOARD (agent-dashboard.sh) — 완전 재설계

### 설계 원칙
- **위에서 아래로 = 워크플로우 순서** (①→⑥)
- **각 섹션 = 하나의 질문에 답**
- **색상 = 상태** (초록=OK, 노랑=주의, 빨강=문제)
- 불필요 항목 제거: `agents:19 scripts:12 skills:6 hooks:0` (정적 수치, 의사결정에 무관)

### 와이어프레임

```
  INSIGHTA work ✽ 11:21  main  M:2 S:0 ?:1        ← ❶ 헤더 (1줄)
─────────────────────────────────────────────────
  NOW  #589 껍데기 카드 재발 조사                     ← ❷ 현재 작업 (2-4줄)
   ✽ active 4m  tools:42  Edit:12 Read:9 Grep:5
   last: Edit local-cards/index.ts L549
   files: local-cards/index.ts(+43) card-validation.ts(R)
─────────────────────────────────────────────────
  AGENTS  1 running · 0 queued                      ← ❸ 서브에이전트 (가변)
   ● Explore 12s "card creation flow 조사"
     Read card-validation.ts → Grep BLOCKED → Read useCardOrch..
─────────────────────────────────────────────────
  CHANGES                                            ← ❹ 변경 추적 (2-5줄)
   M  supabase/functions/local-cards/index.ts +43/-11
   N  docs/design/dashboard-refactoring.md
   · 3a410dd feat(ui): add pagination (#331)
─────────────────────────────────────────────────
  WARNINGS                                           ← ❺ 경고 (0-3줄, 있을 때만)
   ⚠ Read×5 useCardOrchestrator.ts (same file)
   ⚠ API :3000 down — run `npm run api:dev`
─────────────────────────────────────────────────
  PIPELINE  commit → CI → deploy                     ← ❻ 파이프라인 (1-2줄)
   [uncommitted 2] → [CI ● #2465 1h] → [prod ● 8h]
```

### 각 섹션 상세

#### ❶ 헤더 — 1줄, 컨텍스트 즉시 파악
```
  INSIGHTA work ✽ {HH:MM}  {branch}  M:{mod} S:{staged} ?:{new}
```
- 기존: 2줄 (header + PROJECT) → 1줄로 압축
- **제거**: `agents:19 scripts:12 skills:6 hooks:0` (정적, 불필요)
- **제거**: `latest: 3a410dd ...` (CHANGES에서 표시)
- **추가**: M/S/? 수치를 헤더에 통합

#### ❷ NOW — "Claude가 지금 뭘 하고 있나" (핵심)
```
  NOW  {task summary or issue #}
   ✽ active {elapsed}  tools:{N}  {top3 tools}
   last: {최근 도구} {파일명} {라인 또는 상세}
   files: {수정 중 파일 1}(+N/-N)  {파일 2}(R)
```
- **기존 MAIN SESSION 대체** — `task:` 1줄 → 4줄로 확장
- `task`: JSONL에서 최근 `/work` 또는 유저 지시 추출 (>10자)
- `last`: 가장 최근 도구 호출 1건 (도구명 + 파일 + 컨텍스트)
- `files`: 현재 세션에서 Edit/Write한 파일 목록 (JSONL 분석)
- **제거**: `pattern: tools=Bash:47,Read:40...` (상세 내역은 top3로 축약)

#### ❸ AGENTS — 실행 중 서브에이전트만 (간결)
```
  AGENTS  {N} running · {N} queued
   ● {type} {elapsed} "{description 40자}"
     {최근 도구 3개 trail}
   ✓ {type} {elapsed} "{result summary}"
```
- **기존**: RUNNING/DONE/STALE 전부 표시 → **running만 기본, done은 최근 1건만**
- 각 에이전트의 최근 도구 3개를 trail로 표시 → "뭘 하고 있는지" 즉시 파악
- idle 시 섹션 숨김

#### ❹ CHANGES — git 상태 + 최근 커밋
```
  CHANGES
   M  {file path} +{add}/-{del}
   N  {new file path}
   · {last commit hash} {message 50자}
```
- **기존 FILE CHANGES + latest 통합**
- `git diff --stat` + `git status --short` 병합
- 최근 커밋 1줄 (컨텍스트용)

#### ❺ WARNINGS — 문제 있을 때만 표시 (0-3줄)
```
  WARNINGS
   ⚠ {경고 메시지}
```
- **완전 신규 섹션** — 현재 대시보드에 없음
- 소스:
  - 비효율 패턴: 같은 파일 5회+ Read
  - 시스템 이상: API 서버 다운, DB 연결 실패
  - Agent 실패: sub-agent 2회+ 연속 실패
- 문제 없으면 **섹션 자체 숨김** → 공간 절약

#### ❻ PIPELINE — 코드의 현재 위치 (1-2줄)
```
  PIPELINE  commit → CI → deploy
   [{uncommitted N}] → [CI ● #{run} {ago}] → [prod ● {ago}]
```
- **완전 신규** — 코드가 워크플로우 어디에 있는지 시각화
- 3단계: uncommitted → CI → prod
- 각 단계 상태 아이콘 (●=OK, ○=pending, ⊘=fail)
- CI 실패 시 인라인 상세: `[CI ⊘ Test-BE fail]`

### 제거 항목 (현재 → 삭제 이유)

| 현재 항목 | 삭제 이유 |
|----------|----------|
| `agents:19 scripts:12 skills:6 hooks:0` | 정적 수치, 변하지 않음, 의사결정에 무관 |
| `TEAM 13 agents available` | 의사결정에 무관 (available != active) |
| `RECENT` (2-column tool history) | NOW 섹션의 `last:` + `files:`로 대체 |
| `pattern: tools=Bash:47,Read:40...` | top3 도구로 축약, 상세는 불필요 |
| `DELEGATION STATS` | 현재 idle이면 빈 공간만 차지 |

---

## 4. SYSTEM DASHBOARD (ops-dashboard.sh) — 워크플로우 순서 재배치

### 설계 원칙
- **위 = 자주 봐야 하는 것** (health, 이상 감지)
- **아래 = 가끔 확인** (infra, issues)
- **이상 시에만 상세 펼침** (정상 = 1줄, 이상 = 3줄)
- API 서버(:3000) 상태 추가

### 와이어프레임

```
  INSIGHTA sys ⠧ 11:21  up 3h56m                   ← ❶ 헤더
─────────────────────────────────────────────────
  HEALTH  all green                                  ← ❷ 서비스 건강 (1-3줄)
   ● 582ms prod  ● 13ms :8081  ● 3ms :3000
─────────────────────────────────────────────────
  DB  prod 16MB hit:1.00 row:162 conn:11             ← ❸ 데이터베이스 (1-2줄)
   fn ● local-cards ● yt-sync ● yt-auth ● fetch-url
─────────────────────────────────────────────────
  CI  ● #2465 all green 1h ago                       ← ❹ CI/배포 (1-3줄)
   Lint✓ Type✓ Test-BE✓ Test-FE✓ Build✓ A11y✓
   deploy ● prod 8h  ● edge 2h  ● db 3h
─────────────────────────────────────────────────
  INFRA  prod ● EC2 ● SSL(67d) ● Docker(2/2)        ← ❺ 인프라 (1줄)
─────────────────────────────────────────────────
  ISSUES  169/242 (69%)  PRs: 0                      ← ❻ 이슈/PR (1-5줄)
   #330 refactor: dashboard redesign
   #332 feat: AI recommendation
   #334 feat: Mandala Skills
```

### 현재 → 변경 비교

| 현재 섹션 | 줄 수 | 변경 | 근거 |
|----------|------|------|------|
| 헤더 + HEALTH | 2줄 | 합쳐서 2줄 | `:3000` API 상태 추가 |
| SUPABASE | 4줄 | **DB** 2줄로 축약 | dev 상태 제거 (Work에서 안 봄), prod만 |
| GIT | 2줄 | **삭제** → Work Dashboard CHANGES로 이관 | 중복 제거 |
| DEPLOY | 3줄 | **CI** 섹션으로 통합 | CI + deploy를 하나의 파이프라인으로 |
| INFRA | 2줄 | 1줄로 압축 | 정상 시 세부사항 불필요 |
| WORKFLOWS | 1줄 | CI 섹션에 통합 | 별도 섹션 불필요 |
| PRs | 1줄 | ISSUES에 통합 | `PRs: N` 인라인 |
| ISSUES | 6줄 | 3-5줄 유지 | 최근 5개 → 3개로 축소 |

### 이상 감지 시 자동 확장

**정상 시** (compact):
```
  HEALTH  all green
   ● 582ms prod  ● 13ms :8081  ● 3ms :3000
```

**이상 시** (expanded):
```
  HEALTH  ⚠ 1 issue
   ● 582ms prod  ● 13ms :8081  ⊘ :3000 DOWN
   └ API server not responding — `npm run api:dev`
```

**CI 실패 시** (expanded):
```
  CI  ⊘ #2466 FAILED 3m ago
   Lint✓ Type✓ Test-BE⊘ Test-FE✓ Build✓ A11y✓
   └ Test-BE: TS2451 duplicate identifier 'canBootServer'
```

### Supabase dev 제거 근거
- dev Supabase 상태(`dev • DB:25 MB hit:0.98/0.99 tbl:36 row:0 conn:40`)는 개발 중 거의 안 봄
- 로컬 Supabase 문제 시 카드 로딩 실패로 즉시 알 수 있음
- 4줄 → 2줄 절약

---

## 5. 작업 순서 (Implementation Phases)

```
Phase 0  설계 문서 (이 문서)
   │
Phase 1  lib/ 공통 라이브러리 추출
   │     └ dashboard-common.sh + cache-util.sh
   │
Phase 2  Work Dashboard (agent-dashboard.sh) 재작성
   │     └ ❶헤더 → ❷NOW → ❸AGENTS → ❹CHANGES → ❺WARNINGS → ❻PIPELINE
   │
Phase 3  System Dashboard (ops-dashboard.sh) 재작성
   │     └ ❶헤더 → ❷HEALTH(+:3000) → ❸DB → ❹CI → ❺INFRA → ❻ISSUES
   │
Phase 4  통합 테스트 + #330 close
```

### Phase 1: `scripts/lib/` (1h)

**dashboard-common.sh** — 양쪽 공유:
- 색상 팔레트 (통합)
- `truncate_to_terminal()` — ANSI-aware Python truncation
- `format_elapsed()` — 시간 포맷
- `PROJECT_ROOT` / 터미널 크기 감지

**cache-util.sh** — TTL 캐시:
- `cache_get(key, ttl)` / `cache_set(key)`
- `cache_freshness(key, ttl)` — ●/○ 아이콘
- `async_fetch(name, cmd...)` — lock 기반 비동기

### Phase 2: Work Dashboard 재작성 (2-3h)

| 구현 순서 | 섹션 | 데이터 소스 | 난이도 |
|----------|------|-----------|--------|
| 2-1 | ❶ 헤더 | git branch/status | 쉬움 |
| 2-2 | ❹ CHANGES | git diff/status/log | 쉬움 |
| 2-3 | ❷ NOW | JSONL 파싱 (Python) | 중간 — 핵심 |
| 2-4 | ❸ AGENTS | .output JSONL 파싱 | 중간 |
| 2-5 | ❻ PIPELINE | git status + gh run + curl prod | 중간 |
| 2-6 | ❺ WARNINGS | NOW+HEALTH 결과 분석 | 중간 |

**❷ NOW 세부 구현**:
```python
# JSONL에서 추출할 정보:
# 1. 최근 유저 메시지 중 task/issue 언급 → task summary
# 2. 도구별 카운트 → top3
# 3. 마지막 도구 호출 → tool name + file path + line
# 4. Edit/Write 도구에서 file_path 수집 → files 목록
```

**❺ WARNINGS 트리거 조건**:
| 조건 | 메시지 |
|------|--------|
| Read 5회+ 동일 파일 | `⚠ Read×{N} {filename}` |
| Agent 2회+ 연속 실패 | `⚠ Agent {type} failed {N}×` |
| API :3000 down | `⚠ API :3000 down` |
| CI 최신 run 실패 | `⚠ CI #{run} failed` |
| 미커밋 10+ 파일 | `⚠ {N} uncommitted files` |

**❻ PIPELINE 데이터 수집**:
```bash
# Stage 1: uncommitted
uncommitted=$(git status --short | wc -l)

# Stage 2: CI (cache from System Dashboard shared cache)
ci_status=$(cache_get ci_latest 120)

# Stage 3: prod deploy
prod_status=$(cache_get deploy_latest 300)
```

### Phase 3: System Dashboard 재작성 (2h)

| 구현 순서 | 섹션 | 변경 내용 |
|----------|------|----------|
| 3-1 | ❶ 헤더 | 기존 유지, 간소화 |
| 3-2 | ❷ HEALTH | `:3000` 추가 + 임계값 색상 + 이상 시 확장 |
| 3-3 | ❸ DB | SUPABASE → DB 축약, dev 제거, Edge Fn 유지 |
| 3-4 | ❹ CI | DEPLOY+WORKFLOWS 통합, job별 상태 인라인 |
| 3-5 | ❺ INFRA | 2줄 → 1줄 압축 |
| 3-6 | ❻ ISSUES | GIT 제거, PRs 인라인, 이슈 3개로 축소 |

**HEALTH 임계값**:
| 서비스 | Green | Yellow | Red |
|--------|-------|--------|-----|
| prod (insighta.one) | <1000ms | 1-3s | >3s / down |
| dev (:8081) | <100ms | 100-500ms | >500ms / down |
| API (:3000) | responds | — | down |
| DB hit ratio | >0.95 | 0.8-0.95 | <0.8 |

### Phase 4: 통합 테스트 (30m)

```bash
# 1. 양쪽 대시보드 동시 실행
./scripts/tmux-agents.sh

# 2. 정상 상태 확인
# - Work: NOW 섹션에 현재 작업 표시
# - System: HEALTH all green

# 3. 이상 상태 테스트
kill $(lsof -t -i:3000)  # API 서버 종료
# → Work: WARNINGS에 "⚠ API :3000 down" 표시
# → System: HEALTH에 "⊘ :3000 DOWN" 표시

# 4. 줄 수 비교
wc -l scripts/ops-dashboard.sh scripts/agent-dashboard.sh
# 목표: 1844줄 → ~1400줄 (25% 감소)
```

---

## 6. 효율성 트렌드 시각화 — Work Dashboard ❼ TREND

### 설계 의도
> "프로젝트 효율이 점진적으로 개선되는 것을 확인" — 유저 요구.
> eval-scores.md (216 epoch) + session-log.md (228 sessions) 데이터 활용.
> 토큰 비용 최소화: 파일 읽기 1회/5min + Python 인라인 차트 생성.

### 와이어프레임 (Work Dashboard 하단)

```
  TREND  Eval 0.89 ▲  D2:1.00(14연속)  err:0  les:1  ← 요약 1줄
   1.0 ┤                          ·  ··  ·····
   0.9 ┤    ·  · ···· ····· ···· ··  ··        ← Eval (최근 20 epoch)
   0.8 ┤ ···  ·
   0.7 ┤·
       └──────────────────────────────────────
        E197                              E216
```

### 데이터 소스 (토큰 효율적)

| 데이터 | 소스 파일 | 읽기 방식 | TTL |
|--------|----------|----------|-----|
| Eval 점수 | `memory/eval-scores.md` | `tail -25` (마지막 20 epoch) | 300s |
| 세션 에러 | `memory/session-log.md` | `tail -10` (최근 세션) | 300s |
| D2 연속 | eval-scores.md D2 컬럼 | 같은 tail 결과에서 추출 | — |

**토큰 절약**: 전체 파일(76K tokens) 대신 `tail -25`만 읽음 (~500 bytes).

### 차트 구현 (Python 인라인)

```python
# ASCII sparkline — 가로 40자, 세로 4줄
# 입력: eval 점수 배열 (최근 20개)
def sparkline(values, width=40, height=4):
    """0.0-1.0 범위 값을 ASCII 차트로"""
    min_v, max_v = 0.7, 1.0  # 고정 범위 (0.7-1.0 = 유효 범위)
    chars = [' ', '·', '●']  # 빈칸, 점, 볼드점
    rows = []
    for r in range(height):
        threshold = max_v - (max_v - min_v) * r / (height - 1)
        line = f"{threshold:.1f} ┤"
        for v in values[-width:]:
            line += '·' if v >= threshold else ' '
        rows.append(line)
    rows.append("     └" + "─" * len(values[-width:]))
    return '\n'.join(rows)
```

### 요약 줄 지표

```
  TREND  Eval {avg} {▲▼─}  D2:{score}({streak}연속)  err:{N}  les:{N}
```

| 지표 | 산출 | 의미 |
|------|------|------|
| Eval {avg} | 최근 3 epoch 평균 | 전체 효율 |
| ▲▼─ | vs 이전 3 epoch 평균 | 추세 방향 |
| D2:{score}({streak}) | D2 컬럼, 1.00 연속 횟수 | 에러 방지 능력 |
| err:{N} | 현재 세션 에러 수 | 실시간 |
| les:{N} | 현재 세션 교훈 수 | 학습 추적 |

### 갱신 정책
- **차트**: 5분마다 (세션 중 eval 변경 드묾)
- **요약 줄**: 30초마다 (err/les는 JSONL에서 실시간 추출)
- 차트 표시 조건: `SHOW_TREND=1` (기본 ON, 화면 작으면 자동 OFF)
- 화면 <30행이면 요약 줄만, 차트 숨김

### 최종 Work Dashboard 전체 구조

```
  INSIGHTA work ✽ 11:21  main  M:2 S:0 ?:1          ❶ 헤더
─────────────────────────────────────────────
  NOW  #589 껍데기 카드 재발 조사                      ❷ 현재 작업
   ✽ active 4m  tools:42  Edit:12 Read:9 Grep:5
   last: Edit local-cards/index.ts L549
   files: local-cards/index.ts(+43) card-validation.ts(R)
─────────────────────────────────────────────
  AGENTS  1 running                                   ❸ 서브에이전트
   ● Explore 12s "card creation flow 조사"
─────────────────────────────────────────────
  CHANGES                                             ❹ 변경 추적
   M  supabase/functions/local-cards/index.ts +43/-11
   · 3a410dd feat(ui): add pagination (#331)
─────────────────────────────────────────────
  WARNINGS                                            ❺ 경고 (있을때만)
   ⚠ API :3000 down — run `npm run api:dev`
─────────────────────────────────────────────
  PIPELINE  commit → CI → deploy                      ❻ 파이프라인
   [uncommitted 2] → [CI ● #2465 1h] → [prod ● 8h]
─────────────────────────────────────────────
  TREND  Eval 0.89 ▲  D2:1.00(14×)  err:0  les:1    ❼ 효율 트렌드
   1.0 ┤                    ·  ··  ·····
   0.9 ┤  ·  · ···· ····· ···· ··
   0.8 ┤···  ·
   0.7 ┤·
       └──────────────────────────────────
```

---

## 7. 데이터 흐름

```
                    ┌──────────────────┐
                    │  Shared Cache    │
                    │  /tmp/dash-shared │
                    └──────┬───────────┘
                           │
          ┌────────────────┼────────────────┐
          │                │                │
    ┌─────▼──────┐  ┌─────▼──────┐  ┌─────▼──────┐
    │ Work Dash  │  │ System Dash│  │ cc-init-   │
    │ (agent)    │  │ (ops)      │  │ context.sh │
    └─────┬──────┘  └─────┬──────┘  └────────────┘
          │                │
    ┌─────▼──────┐  ┌─────▼──────┐
    │ JSONL      │  │ curl/gh/   │
    │ session    │  │ ssh/psql   │
    └────────────┘  └────────────┘
```

**Shared Cache 항목** (양쪽 공유):
| Key | Writer | Reader | TTL |
|-----|--------|--------|-----|
| `health_api` | System | Work (WARNINGS) | 15s |
| `ci_latest` | System | Work (PIPELINE) | 120s |
| `deploy_latest` | System | Work (PIPELINE) | 300s |

---

## 7. 제약 사항

- `agent-dashboard.sh`, `ops-dashboard.sh` **삭제 금지** (CLAUDE.md)
- 파일명/위치 변경 없음 — 내부 재작성만
- `lib/` 신규 생성 허용
- tmux pane 크기: 우측 ~100cols × 41rows (상단), ~100cols × 23rows (하단)
- JSONL 파싱은 Python3 인라인 유지 (외부 의존성 추가 금지)
