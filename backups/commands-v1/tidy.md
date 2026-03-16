---
name: tidy
description: GitHub Issues + Project board 동기화 — 불일치 감지, 상태 수정, MEMORY.md 반영
allowed-tools: Bash(gh:*), Bash(python3:*), Bash(cat:*), Read, Edit, Grep, Bash(wc:*)
---

GitHub Issues와 Project board(#2 Frontend, #3 GraphRAG)의 상태를 동기화하고,
MEMORY.md의 GitHub Issues 섹션을 최신화한다.

사용법: `/tidy [scope?]`
- scope 생략 시: 전체 동기화 (Issues + Project boards + MEMORY.md)
- `issues`: Issues만 정리 (stale 감지, close 후보)
- `board`: Project board만 동기화
- `memory`: MEMORY.md GitHub Issues 섹션만 최신화

## 핵심 원칙

> Issue/Board 상태는 **실제 코드 상태**를 반영해야 한다.
> 커밋/PR이 머지된 Story는 반드시 closed + Done 상태여야 한다.
> 수동 확인 없이 자동 close하지 않는다 — 유저 확인 필수.

## 실행 순서

### Phase 1: 현황 수집 (병렬)

```bash
# 1a. 모든 오픈 이슈
gh issue list --state open --json number,title,labels,milestone --jq '.[] | "#\(.number): \(.title) [\(.labels | map(.name) | join(","))]"'

# 1b. 최근 닫힌 이슈 (지난 7일)
gh issue list --state closed --json number,title,closedAt --jq '.[] | "#\(.number): \(.title) (\(.closedAt))"' -L 20

# 1c. Project #2 (Frontend) 아이템 + 상태
gh project item-list 2 --owner JK42JJ --format json -L 50

# 1d. Project #3 (GraphRAG) 아이템 + 상태
gh project item-list 3 --owner JK42JJ --format json -L 20

# 1e. 최근 커밋에서 참조된 이슈 번호
git log --oneline -20 | grep -oP '#\d+' | sort -u

# 1f. 오픈 PR 목록
gh pr list --json number,title,state,labels

# 1g. 마일스톤 목록 + 상태
gh api repos/JK42JJ/insighta/milestones?state=all --jq '.[] | "#\(.number): \(.title) (\(.state)) open:\(.open_issues) closed:\(.closed_issues)"'

# 1h. 오픈 이슈의 마일스톤 할당 현황
gh issue list --state open --json number,title,milestone --jq '.[] | select(.milestone == null) | "#\(.number): \(.title) [NO MILESTONE]"'
```

### Phase 2: 불일치 감지 (Mismatch Detection)

아래 5가지 불일치 패턴을 자동 감지한다:

| # | 패턴 | 감지 방법 | 조치 |
|---|------|----------|------|
| M1 | **Issue closed + Board not Done** | Issue state=closed, Board status≠Done | Board → Done 변경 |
| M2 | **Issue open + Board Done** | Issue state=open, Board status=Done | Issue close 후보 (유저 확인) |
| M3 | **커밋에 #N 참조 + Issue open** | git log에 `(#N)` 있고 Issue open | close 후보 (유저 확인) |
| M4 | **Issue open + no activity 30d+** | Issue에 최근 30일 코멘트/커밋 없음 | stale 경고 |
| M5 | **Board에 없는 오픈 Issue** | 오픈 Issue가 관련 Project board에 미등록 | Board 추가 후보 |
| M6 | **Issue에 Milestone 미설정** | Epic #54 하위 Issue에 milestone 없음 | Milestone 할당 |
| M7 | **완료된 Milestone 미종료** | 하위 Issue 전체 closed인데 milestone open | Milestone close |

**감지 스크립트** (Phase 1 데이터 기반):
```python
# /tmp/tidy_check.py — Phase 1 데이터를 파싱하여 M1-M5 감지
```

### Phase 3: 수정 계획 출력

감지된 불일치를 테이블로 출력하고 유저 확인을 받는다.

```
## GitHub Tidy Report

### Mismatches Found ({count})
| # | Type | Issue | Current | Expected | Action |
|---|------|-------|---------|----------|--------|
| 1 | M1 | #67 | Board: In Progress | Board: Done | `gh project item-edit ...` |
| 2 | M2 | #68 | Issue: Open | Issue: Closed | `gh issue close #68` |
...

### Stale Issues (30d+ no activity)
- #{N}: {title} — last activity: {date}

### Board Coverage
- Project #2: {N}/{M} open stories on board
- Project #3: {N}/{M} open issues on board
- Missing from board: {list}

자동 수정할까요? (y/n, 또는 번호 지정하여 선택적 수정)
```

### Phase 4: 수정 실행 (유저 확인 후)

**M1 수정 (Board → Done)**:
```bash
# Project item의 Status 필드를 Done으로 변경
gh project item-edit --project-id {PROJECT_ID} --id {ITEM_ID} --field-id {STATUS_FIELD_ID} --single-select-option-id {DONE_OPTION_ID}
# Completed 날짜 설정 (오늘)
gh project item-edit --project-id {PROJECT_ID} --id {ITEM_ID} --field-id PVTF_lAHOCmI-Hs4BQ9RNzg-_Okg --date $(date +%Y-%m-%d)
```

**M2 수정 (Issue close)**:
```bash
gh issue close {NUMBER} --reason completed
# Board에서 Completed 날짜 설정
gh project item-edit --project-id {PROJECT_ID} --id {ITEM_ID} --field-id PVTF_lAHOCmI-Hs4BQ9RNzg-_Okg --date $(date +%Y-%m-%d)
```

**M3 수정 (커밋 참조 기반 close)**:
```bash
gh issue close {NUMBER} --reason completed --comment "Completed in {commit_hash}"
# Board에서 Completed 날짜 설정
gh project item-edit --project-id {PROJECT_ID} --id {ITEM_ID} --field-id PVTF_lAHOCmI-Hs4BQ9RNzg-_Okg --date $(date +%Y-%m-%d)
```

**M5 수정 (Board에 추가)**:
```bash
ITEM_ID=$(gh project item-add {PROJECT_NUMBER} --owner JK42JJ --url https://github.com/JK42JJ/insighta/issues/{NUMBER} --format json | jq -r '.id')
# Start Date 설정 (오늘)
gh project item-edit --project-id {PROJECT_ID} --id $ITEM_ID --field-id PVTF_lAHOCmI-Hs4BQ9RNzg-_Ok8 --date $(date +%Y-%m-%d)
```

**M6 수정 (Milestone 할당)**:
```bash
# Epic #54 하위 Issue에 적절한 Phase milestone 할당
gh issue edit {NUMBER} --milestone "Phase {N}: {name}"
```

**M7 수정 (완료 Milestone close)**:
```bash
# 하위 Issue 전체 closed → milestone close
gh api repos/JK42JJ/insighta/milestones/{MILESTONE_NUMBER} -X PATCH -f state=closed
```

### Phase 5: MEMORY.md 동기화

수정 완료 후 MEMORY.md의 GitHub Issues 섹션을 최신화한다.

1. `memory/MEMORY.md`를 Read
2. `## GitHub Issues` 섹션 찾기
3. Epic #54 Phase 테이블: 완료된 Phase 표시 업데이트 + 새 Phase 추가
4. `### 기타 오픈 이슈` 테이블: closed된 이슈 제거, 새 오픈 이슈 추가
5. Milestone 현황 반영 (Phase 1-N 완료/진행 상태)
6. 200줄 제한 확인

### Phase 6: 결과 요약

```
## Tidy Complete

### Actions Taken
- Board status updated: {N} items
- Issues closed: {N} issues
- Issues added to board: {N} items
- Milestones: {N} assigned, {N} closed
- MEMORY.md: {updated/no change}

### Current State
- Open issues: {N} (stories: {N}, ux: {N}, infra: {N}, other: {N})
- Project #2: {done}/{total} items Done
- Project #3: {done}/{total} items Done
- Stale (30d+): {N} issues

### Next Tidy
- {다음 /tidy 시 확인할 사항 1-2개}
```

## Project Board 참조 정보

### Project #2: Insighta: Frontend Design Refactoring
- URL: https://github.com/users/JK42JJ/projects/2
- Views:
  - View 1 (Board): https://github.com/users/JK42JJ/projects/2/views/1
  - View 2 (By Label): https://github.com/users/JK42JJ/projects/2/views/2
  - View 3 (Table): https://github.com/users/JK42JJ/projects/2/views/3
- Status options: Todo, In Progress, Done

### Project #3: Insighta: GraphRAG
- URL: https://github.com/users/JK42JJ/projects/3
- Items: GraphRAG 관련 이슈 (#103, #104, #105)

## 주의사항

- **자동 close 금지**: 항상 유저 확인 후 실행. M2/M3는 후보만 제시.
- **Epic은 close하지 않음**: #54, #105 등 Epic 이슈는 하위 Story가 전부 완료되어도 수동 close.
- **Board status 변경은 안전**: Done↔Todo↔In Progress 변경은 비파괴적, 유저 확인 없이 M1 자동 수정 가능.
- **MEMORY.md 200줄 제한**: 이슈 테이블이 너무 길면 closed 이슈 행 제거로 압축.
- **Board 날짜 필드 필수**: Issue를 Done으로 변경하거나 close할 때 반드시 `Completed` 날짜 설정. Board에 새 아이템 추가 시 `Start Date` 설정. 날짜 필드 ID:
  - Completed: `PVTF_lAHOCmI-Hs4BQ9RNzg-_Okg`
  - Start Date: `PVTF_lAHOCmI-Hs4BQ9RNzg-_Ok8`
- `/checkpoint`에서 이 skill을 호출하지 않음 — 독립 실행. 단, `/checkpoint` Step 4에서 "GitHub Issues 상태 변경 감지 시 `/tidy` 실행 권장" 안내 추가.
