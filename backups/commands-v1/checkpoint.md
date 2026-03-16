---
name: checkpoint
description: 세션 진행사항을 memory 파일에 자동 기록 + 교훈 추출 + memory 자기개선 + Session Eval
allowed-tools: Read, Edit, Write, Bash(git:*), Bash(tail:*), Bash(wc:*), Grep
---

현재 세션의 작업 내용을 자동으로 정리하여 memory에 기록하고,
세션에서 얻은 **교훈을 추출**하여 관련 memory 파일을 **자동 개선**한다.

사용법: /checkpoint [title]
- title 생략 시 git log 기반으로 자동 생성

## 핵심 원칙

> `/checkpoint`는 단순 기록이 아니라 **학습 사이클의 Write 단계**다.
> 매 checkpoint가 memory 파일을 조금씩 더 유용하게 만들어야 한다.
> 다음 `/boot`에서 로드될 때, 이전보다 더 나은 컨텍스트를 제공해야 한다.

## 실행 순서

### Step 1: 정보 수집 (병렬 실행)

- `git log --oneline` (마지막 checkpoint 이후 커밋들)
- `git diff --stat` (미커밋 변경사항)
- `git status` (untracked 파일)
- 현재 `checkpoint.md` 읽기 (마지막 체크포인트 번호 파악)
- 현재 `MEMORY.md` 읽기
- **세션 중 수행한 모든 작업 회상** (git 추적 여부와 무관)
- **유저 요청 전수 회상** — 코드 변경 여부와 무관하게, 세션 중 유저가 요청/지시한 모든 사항을 회상:
  - 코드 변경으로 이어진 요청 (실행 완료)
  - **코드 변경 없이 기록만 필요한 요청** (Issue 생성, 마일스톤 추가, 향후 작업 지시 등)
  - **외부 자료/URL/문서를 제공한 요청** (참조 서비스, 디자인 철학 등)
  - 세션 도중 컨텍스트 컴팩션이 발생했어도 누락 없이 추적

checkpoint.md 경로: `~/.claude/projects/-Users-jeonhokim-cursor-insighta/memory/checkpoint.md`
MEMORY.md 경로: `~/.claude/projects/-Users-jeonhokim-cursor-insighta/memory/MEMORY.md`
session-log.md 경로: `~/.claude/projects/-Users-jeonhokim-cursor-insighta/memory/session-log.md`

마지막 checkpoint의 커밋 해시를 checkpoint.md에서 찾아서, 그 이후의 커밋만 대상으로 한다.

### Step 2: checkpoint.md 업데이트

- 마지막 Checkpoint 번호 + 1로 새 항목 추가
- 포맷:
  ```
  ### Checkpoint N: {title} (COMPLETED — {YYYY-MM-DD})
  - **커밋**: `{hash}` — `{commit message}`  (여러 커밋이면 각각 나열, 없으면 "미커밋")
  - **로컬 전용 변경**: {git 추적 밖 파일 변경 목록} (있는 경우)
  - **수정 파일**: {변경된 모든 파일 목록 요약}
  - **변경 내용**: {주요 변경사항 2-5줄}
  - **빌드**: 빌드/테스트 결과 (확인한 경우)
  - **교훈**: {이번 세션에서 배운 것}
  - **Improvement Target**: {다음 세션에서 시도할 구체적 행동 1가지}
  - **User Requests**: {세션 중 유저가 요청했지만 코드로 완료되지 않은 항목}
  ```
- 미커밋 변경사항이 있으면 Pending Work 섹션에 추가
- 기존 Pending Work에서 완료된 항목은 체크 표시

**User Requests 작성 규칙**:
- 코드 변경으로 완료된 요청은 "변경 내용"에 기록되므로 여기엔 불포함
- **미실행/부분 실행 요청만** 기록: Issue 생성 지시, 향후 작업 계획, 디자인 방향 제시 등
- 유저가 제공한 **외부 자료(URL, 문서, 참조 서비스)** 는 요약과 함께 보존
- 형식: `{요청 내용 1줄} → {현재 상태: Issue #N 생성됨 / Pending / 미반영}`
- 요청이 모두 코드로 완료되었으면 이 필드는 "없음" 또는 생략

**Improvement Target 작성 규칙**:
- 다음 세션에서 **5분 내 완료 가능한 구체적 액션** 1가지
- 좋은 예: "troubleshooting.md에 '빌드≠런타임' 섹션 추가", "eval-scores.md D3 scoring guide에 예시 추가"
- 나쁜 예: "OOO 검증", "OOO 확인" (막연한 동사 금지)
- 형식: "{대상 파일/도구}에 {구체적 행동}" — 실행 가능해야 함
- 단순 세션이라 타겟이 없으면 "—"

**checkpoint.md 로테이션**:
- 20개 초과 시 가장 오래된 10개를 `checkpoint-archive.md`에 이동
- Pending Work 섹션은 항상 유지

### Step 2a: session-log.md 행 추가

session-log.md를 Read한 뒤 마지막 행 아래에 새 행 추가:

```
| {N+1} | {date} | {branch} | {domain} | {files} | {new} | {errors} | {lessons} | {build} | {key action} | {improvement target} | {open reqs} |
```

필드 정의:
- Files: `{modified}M+{new}N` 형식 또는 숫자
- Errors: 세션 중 발생한 에러/실패 횟수
- Lessons: 유효 교훈 수
- Build: pass/fail/N/A
- Improvement Target: Step 2에서 도출한 것과 동일
- **Open Reqs**: 세션 중 유저가 요청했지만 코드로 완료되지 않은 항목 수 (0이면 "0", 있으면 숫자+간략 내용. 예: `2: #118 디자인, milestone 추가`)

**주의**: 이 필드가 누적되면 `/retrospective`에서 "유저 요청 누락 패턴" 분석 가능

### Step 2b: request-journal.md 업데이트

request-journal.md 경로: `~/.claude/projects/-Users-jeonhokim-cursor-insighta/memory/request-journal.md`

1. `tail -30 request-journal.md`로 오늘 날짜 섹션 존재 여부 확인
2. 오늘 날짜 H3 헤더가 없으면 파일 상단(Legend 아래)에 새 날짜 섹션 추가
3. 세션 중 **모든** 유저 요청을 행으로 추가 (Step 1에서 회상한 전수 목록)

**작성 규칙** (30초 이내 완료):
- 요약: 40자 이내, 핵심 동사+대상
- Category: `feature`, `bugfix`, `design`, `backlog`, `research`, `meta` 중 택 1
- Status: `done`(완료), `issue`(Issue 등록), `noted`(기록만), `wip`(진행중), `cancelled`(취소)
- Ref: 커밋 해시, Issue #, CP번호 등
- 번호(#): 해당 날짜 내 순번 (오늘 기존 마지막 번호 + 1부터)

**200줄 상한**: 초과 시 가장 오래된 날짜의 `done` 항목부터 삭제

### Step 3: 교훈 추출 (Lessons Learned)

세션을 돌아보며 아래 4가지 관점에서 교훈을 추출한다. **해당 사항이 없으면 건너뛴다.**

#### 3a. 에러 패턴 → troubleshooting.md (Regression Counter 포함)

기존 절차(Read → 중복 확인 → 새 패턴이면 추가)에 **Regression Counter** 로직 추가:

1. 이번 세션의 에러가 troubleshooting.md의 **기존 패턴과 동일**한지 확인
2. **기존 패턴 재발 시**:
   - 해당 패턴의 `recurrence` 카운터 +1 (헤더의 `[LEVEL-N, recurrence: N]` 업데이트)
   - Escalation Level 판정:
     - recurrence = 1: **LEVEL-1** (기록만)
     - recurrence = 2: **LEVEL-2** → boot.md Phase 5의 Pre-flight Checklist에 항목 추가
     - recurrence >= 3: **LEVEL-3** → CLAUDE.md "핵심 규칙" 섹션에 hard rule 추가
   - LEVEL-2 도달 시: troubleshooting.md의 "Regression Watchlist (LEVEL-2+)" 섹션에 Pre-flight 체크리스트 추가
   - LEVEL-3 도달 시: CLAUDE.md에 해당 패턴의 blocking rule 추가 (유저 확인 필수)
3. **새 패턴 발생 시**: `[LEVEL-1, recurrence: 1]` 태그로 헤더 작성
4. **De-escalation 판정** (패턴 개선 시):
   - D2 = 1.00이 연속 5 epoch → LEVEL-3 → LEVEL-2
   - D2 = 1.00이 연속 10 epoch → LEVEL-2 → LEVEL-1
   - LEVEL-1 + D2 = 1.00 연속 5 epoch → watchlist 해제

#### 3b. 효율 패턴 → work-efficiency.md
#### 3c. 아키텍처 결정 → architecture.md
#### 3d. 규칙 위반/부족 → CLAUDE.md 개선 후보

(3b~3d의 절차는 기존과 동일: Read → 중복 확인 → 새 패턴이면 추가)

### Step 4: Memory 위생 점검 (Memory Hygiene)

1. "현재 알려진 이슈"에서 해결된 항목 → `[x]` 체크
2. "GitHub Issues" 테이블 상태 업데이트
3. Stale 정보 수정
4. 200줄 제한 준수
5. `/tidy` 실행 권장 여부 안내

### Step 5: MEMORY.md 업데이트

- "최근 작업" 섹션을 현재 날짜와 작업 내용으로 교체
- 200줄 제한 준수

### Step 6: Session Eval (v3 — Regression Multiplier)

eval-scores.md를 Read한 뒤 Scoring Guide에 따라 채점.

eval-scores.md 경로: `~/.claude/projects/-Users-jeonhokim-cursor-insighta/memory/eval-scores.md`

**채점 절차**:

1. `eval-scores.md`를 Read (Scoring Guide v3 + 이전 Epoch 확인)
2. 이번 세션을 5개 Dimension으로 **엄격하게** 채점 (0.00 ~ 1.00, **소수점 2자리**):
   - **D1 Context Retention**: memory 정보 재탐색 횟수 (필수 코드 탐색은 감점 아님)
   - **D2 Error Prevention**: 기존 troubleshooting 패턴 재발 여부 + **Regression Multiplier 적용**
     - 해당 패턴 recurrence=1 (첫 발생): base score × 1.0
     - 해당 패턴 recurrence=2: base score × 0.7
     - 해당 패턴 recurrence=3+: base score × 0.5
   - **D3 Improvement Action**: 이전 Improvement Target 적용 여부 + 새 개선점 발견 여부
   - **D4 Memory Hygiene**: stale 정보 수정, 줄 수 준수
   - **D5 Work Efficiency**: 병렬 실행, Agent 위임, 전용 도구 준수율
3. Eval = 유효 항목 평균 (N/A 제외)
4. `eval-scores.md`의 Epoch Log 테이블에 새 행 추가
5. 이전 Epoch 대비 변화 분석
6. 5 epoch 이상 → Trend Analysis 업데이트

### Step 7: 결과 요약

아래 형식으로 출력한다:

```
## Checkpoint #{N}: {title}

### Record
- {변경 내용 요약 2-3줄}
- MEMORY.md: {변경 여부}
- 미커밋: {있으면 경고}

### Lessons Applied (이번 세션의 자기개선)
| 대상 파일 | 변경 내용 | 근거 |
|----------|----------|------|
| {파일명} | {추가/수정 내용} | {세션 중 어떤 경험에서 비롯} |
(해당 없으면 "이번 세션에서 추출된 새 교훈 없음" 출력)

### User Requests (미실행/부분 실행)
| 요청 | 상태 | 비고 |
|------|------|------|
| {요청 내용} | {Issue #N 생성됨 / Pending / 미반영} | {외부 URL/자료 있으면 기재} |
(모두 코드로 완료되었으면 "모든 유저 요청이 코드 변경으로 완료됨" 출력)

### Improvement Target
> {다음 세션에서 시도할 구체적 행동}
(이 타겟은 다음 /boot Phase 6a-2에서 리마인드됨)

### Session Eval (Epoch {N})
| D1 | D2 | D3 | D4 | D5 | **Eval** |
|----|----|----|----|----|----------|
| {score} | {score} | {score} | {score} | {score} | **{avg}** |
- vs Previous: {Eval 변화 +/-} | {가장 큰 변화 Dimension 언급}
- Lowest: D{N} ({score}) — {개선 방향 한 줄}

### Memory Health
- troubleshooting.md: {항목 수} patterns (+{N} new)
- Stale entries fixed: {N}
- MEMORY.md: {현재 줄 수}/200
- request-journal.md: {N}건 추가 (총 {total}건)
- session-log.md: {행 수} sessions logged
```

$ARGUMENTS가 있으면 checkpoint 제목으로 사용. 없으면 커밋 메시지들에서 자동 생성.

## 자기개선 판단 기준

### 추가할 가치가 있는 교훈의 조건
- **재현 가능**: 같은 상황이 다시 올 수 있음
- **비자명**: 이 프로젝트 특유의 교훈
- **행동 가능**: "다음에 X 하면 된다" 형태
- **검증됨**: 이번 세션에서 실제로 확인함

### 추가하지 않을 것
- 일회성 실수 (재현 가능성 낮음)
- 이미 기록된 패턴의 반복 (중복)
- 추측이나 미검증 가설
