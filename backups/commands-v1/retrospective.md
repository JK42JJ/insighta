---
name: retrospective
description: session-log 데이터 분석 → 패턴 발견 → 구체적 개선 제안
allowed-tools: Read, Edit, Write, Grep, Bash(wc:*)
---

session-log.md의 정형 데이터를 분석하여 **구체적 개선 제안**을 생성한다.
유저 승인 후 memory/규칙에 적용하고, retrospective.md에 이력 기록.

## 실행 순서

### Step 1: 데이터 로드 (병렬)

```
Read: ~/.claude/projects/-Users-jeonhokim-cursor-insighta/memory/session-log.md
Read: ~/.claude/projects/-Users-jeonhokim-cursor-insighta/memory/eval-scores.md
Read: ~/.claude/projects/-Users-jeonhokim-cursor-insighta/memory/troubleshooting.md
Read: ~/.claude/projects/-Users-jeonhokim-cursor-insighta/memory/work-efficiency.md
Read: ~/.claude/projects/-Users-jeonhokim-cursor-insighta/memory/retrospective.md
```

### Step 2: 에러 패턴 분석

session-log에서 Errors > 0인 세션 추출하여:
- **도메인별 에러 빈도**: frontend X건, backend Y건, infra Z건
- **에러 → 해결 세션 수**: 1세션 해결 vs 다세션 지속
- **troubleshooting.md에 이미 있는 패턴 재발 여부**
- **반복 에러 패턴** (같은 도메인에서 2회+ 에러)

### Step 3: 효율 트렌드 분석

- 세션당 평균 수정 파일 수 추이
- 에러 0 세션 비율 추이
- **Improvement Target 적용률**:
  - 타겟 있었던 세션 수
  - 그 다음 세션에서 적용한 수
  - 적용률 = 적용 / (타겟 있었던 수)

### Step 4: Eval 트렌드 분석

eval-scores.md의 Epoch Log에서:
- 각 Dimension의 이동 평균 (3-epoch window)
- **최약 Dimension** 식별 (3-MA 기준)
- **정체 Dimension** (5 epoch 이상 같은 범위)
- **D3 Improvement Action 변화** (v2 전환 이후)

### Step 5: 개선 제안 생성

분석 결과를 바탕으로 3가지 유형의 제안:

**Type A: Memory 보강**
- "frontend 에러가 3/10 세션에서 발생 → troubleshooting.md에 OOO 패턴 추가 제안"

**Type B: 규칙 강화**
- "Improvement Target 미적용이 3회 연속 → boot 리마인드 방식 변경 제안"

**Type C: 규칙 폐지/축소**
- "work-efficiency.md의 OOO 규칙이 10세션간 0회 참조 → 삭제 후보"

### Step 6: 결과 출력

```
## Retrospective Analysis (YYYY-MM-DD, {N}세션 대상)

### A. 에러 패턴
| 도메인 | 에러 세션 수 | 비율 | 주요 원인 |
|--------|------------|------|----------|
(에러 0이면 "분석 대상 에러 없음")

### B. 효율 트렌드
- 평균 수정 파일: {N}
- 에러 0 비율: {X}%
- Improvement Target 적용률: {Y}% ({적용}/{타겟 있었던 수})

### C. Eval 트렌드
- 최약 Dimension: D{N} ({이름}), 3-MA: {score}
- 정체 Dimension: {있으면 표시}
- Eval 추세: {상승/정체/하락}

### D. 개선 제안
| # | 유형 | 제안 | 근거 (데이터) | 대상 파일 |
|---|------|------|-------------|----------|

### E. 이전 제안 추적
| # | 제안 | 적용일 | 효과 |
|---|------|-------|------|
(retrospective.md "적용된 개선" 테이블에서 최근 5건)
```

### Step 7: 유저 승인 후 적용

- 유저가 승인한 항목만 Canonical Source에 적용 (CLAUDE.md SSOT 규칙 준수)
- 적용 후 `retrospective.md`에 기록:
  - "적용된 개선" 테이블에 행 추가
  - "Rule Evolution Log"에 행 추가

$ARGUMENTS: 분석 대상 세션 수 (기본값: session-log의 전체 행 수, 최대 50)
