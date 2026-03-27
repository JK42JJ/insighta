---
name: save
description: Auto-record session progress to memory files + extract lessons + memory self-improvement + Session Eval
allowed-tools: Read, Edit, Write, Bash(git:*), Bash(tail:*), Bash(wc:*), Bash(npm:*), Bash(npx:*), Bash(chmod:*), Grep
---

Automatically organize and record the current session's work to memory,
and **extract lessons** to **auto-improve** related memory files.

Usage: /save [title]
- If title omitted, auto-generate from git log

## Core Principles

> `/save` is not just recording — it is the **Write stage of the learning cycle**.
> Each checkpoint should make memory files incrementally more useful.
> When loaded by the next `/init`, it MUST provide better context than before.

## Execution Order

### Step 0: Ensure memory file permissions

```bash
chmod +x ~/.claude/projects/-Users-jeonhokim-cursor-insighta/memory/*
```

Run this first to prevent permission popups when writing to memory files.

### Step 1: Gather Information (parallel execution)

**Token optimization**: Use `bash scripts/cc-save-context.sh [last-hash]` (1 call) instead of individual git/tail/wc commands (5+ calls).

- `git log --oneline` (commits since last checkpoint)
- `git diff --stat` (uncommitted changes)
- `git status` (untracked files)
- Read current `checkpoint.md` (determine last checkpoint number)
- Read current `MEMORY.md`
- **Recall ALL work performed during this session** (regardless of git tracking)
- **Recall ALL user requests** — regardless of whether code changed:
  - Requests that resulted in code changes (execution complete)
  - **Requests needing only recording, not code changes** (Issue creation, milestone additions, future work directives, etc.)
  - **Requests providing external resources/URLs/documents** (reference services, design philosophy, etc.)
  - Track without omission even if context compaction occurred mid-session

checkpoint.md path: `~/.claude/projects/-Users-jeonhokim-cursor-insighta/memory/checkpoint.md`
MEMORY.md path: `~/.claude/projects/-Users-jeonhokim-cursor-insighta/memory/MEMORY.md`
session-log.md path: `~/.claude/projects/-Users-jeonhokim-cursor-insighta/memory/session-log.md`

Find the last checkpoint's commit hash from checkpoint.md, and only target commits after that.

### Step 2: Update checkpoint.md

- Add new entry with last Checkpoint number + 1
- Format:
  ```
  ### Checkpoint N: {title} (COMPLETED — {YYYY-MM-DD})
  - **커밋**: `{hash}` — `{commit message}`  (list each if multiple commits, "미커밋" if none)
  - **로컬 전용 변경**: {list of file changes outside git tracking} (if any)
  - **수정 파일**: {summary of all changed files}
  - **변경 내용**: {key changes in 2-5 lines}
  - **빌드**: build/test results (if verified)
  - **교훈**: {what was learned this session}
  - **Improvement Target**: {1 specific action to try next session}
  - **User Requests**: {user requests not completed as code during this session}
  ```
- If uncommitted changes exist, add to Pending Work section
- Check off completed items from existing Pending Work

**User Requests writing rules**:
- Requests completed via code changes are recorded in "변경 내용", NOT here
- Record **only unexecuted/partially executed requests**: Issue creation directives, future work plans, design direction, etc.
- **Preserve external resources (URLs, documents, reference services)** provided by user with summaries
- Format: `{request content 1 line} → {status: Issue #N created / Pending / not reflected}`
- If all requests completed as code, this field is "없음" or omitted

**Improvement Target writing rules**:
- 1 specific action **completable within 5 minutes** in the next session
- Good examples: "Add 'build≠runtime' section to troubleshooting.md", "Add examples to eval-scores.md D3 scoring guide"
- Bad examples: "Verify OOO", "Check OOO" (vague verbs forbidden)
- Format: "{target file/tool}에 {specific action}" — MUST be actionable
- If simple session with no target, use "—"

**checkpoint.md rotation**:
- When exceeding 20 entries, move the 10 oldest to `checkpoint-archive.md`
- Always retain the Pending Work section

### Step 2a: Append session-log.md row

Read session-log.md then append a new row below the last row:

```
| {N+1} | {date} | {branch} | {domain} | {files} | {new} | {errors} | {lessons} | {build} | {key action} | {improvement target} | {open reqs} |
```

Field definitions:
- Files: `{modified}M+{new}N` format or number
- Errors: number of errors/failures during session
- Lessons: number of valid lessons
- Build: pass/fail/N/A
- Improvement Target: same as derived in Step 2
- **Open Reqs**: count of user requests not completed as code (0 if none, number + brief content if any. e.g., `2: #118 디자인, milestone 추가`)

**Note**: accumulation of this field enables "user request omission pattern" analysis in `/retro`

### Step 2b: Update request-journal.md

request-journal.md path: `~/.claude/projects/-Users-jeonhokim-cursor-insighta/memory/request-journal.md`

1. `tail -30 request-journal.md` to check if today's date section exists
2. If no H3 header for today, add new date section at top (below Legend)
3. Add rows for **ALL** user requests from this session (full list recalled in Step 1)

**Writing rules** (complete within 30 seconds):
- Summary: max 40 characters, core verb + target
- Category: choose from `feature`, `bugfix`, `design`, `backlog`, `research`, `meta`
- Status: `done` (complete), `issue` (Issue registered), `noted` (recorded only), `wip` (in progress), `cancelled`
- Ref: commit hash, Issue #, CP number, etc.
- Number (#): sequential within that date (start from today's existing last number + 1)

**200-line cap**: when exceeded, delete oldest date's `done` items first

### Step 2c: Update TEST.md

If test-related changes occurred, or build/tests were run:
1. Capture `npm run typecheck`, `npm run lint`, `npm test -- --coverage` results (if run)
2. Check if `tests/TEST.md` exists → update relevant sections if so
3. Update CLI command coverage matrix (if it exists)
4. Update last-updated date

**Skip this Step if TEST.md does not exist.**

### Step 3: Extract Lessons (Lessons Learned)

Review the session from the following 4 perspectives and extract lessons. **Skip if nothing applies.**

#### 3a. Error patterns → troubleshooting.md (with Regression Counter)

Existing procedure (Read → check duplicates → add if new pattern) PLUS **Regression Counter** logic:

1. Check if this session's error matches an **existing pattern** in troubleshooting.md
2. **If existing pattern recurs**:
   - Increment that pattern's `recurrence` counter (update `[LEVEL-N, recurrence: N]` in header)
   - Escalation Level determination:
     - recurrence = 1: **LEVEL-1** (record only)
     - recurrence = 2: **LEVEL-2** → add item to init.md Phase 5 Pre-flight Checklist
     - recurrence >= 3: **LEVEL-3** → add hard rule to CLAUDE.md "핵심 규칙" section
   - On reaching LEVEL-2: add Pre-flight checklist to troubleshooting.md "Regression Watchlist (LEVEL-2+)" section
   - On reaching LEVEL-3: add blocking rule for that pattern to CLAUDE.md (user confirmation required)
3. **If new pattern**: write header with `[LEVEL-1, recurrence: 1]` tag
4. **De-escalation determination** (when pattern improves):
   - D2 = 1.00 for 5 consecutive epochs → LEVEL-3 → LEVEL-2
   - D2 = 1.00 for 10 consecutive epochs → LEVEL-2 → LEVEL-1
   - LEVEL-1 + D2 = 1.00 for 5 consecutive epochs → remove from watchlist

#### 3b. Efficiency patterns → work-efficiency.md
#### 3c. Architecture decisions → architecture.md
#### 3d. Rule violations/gaps → CLAUDE.md improvement candidates

(3b-3d follow the same procedure: Read → check duplicates → add if new pattern)

### Step 4: Memory Hygiene Check

1. Check off resolved items in "현재 알려진 이슈"
2. Update "GitHub Issues" table status
3. Fix stale information
4. Enforce 200-line limit
5. Advise whether `/tidy` run is recommended

### Step 5: Update MEMORY.md

- Replace "최근 작업" section with current date and work content
- Enforce 200-line limit

### Step 6: Session Eval (v3 — Regression Multiplier)

Read eval-scores.md then score according to the Scoring Guide.

eval-scores.md path: `~/.claude/projects/-Users-jeonhokim-cursor-insighta/memory/eval-scores.md`

**Scoring procedure**:

1. Read `eval-scores.md` (Scoring Guide v3 + previous Epochs)
2. Score this session **strictly** across 5 Dimensions (0.00 ~ 1.00, **2 decimal places**):
   - **D1 Context Retention**: count of memory info re-lookups (mandatory code exploration is NOT penalized)
   - **D2 Error Prevention**: existing troubleshooting pattern recurrence + **Regression Multiplier applied**
     - Pattern recurrence=1 (first occurrence): base score × 1.0
     - Pattern recurrence=2: base score × 0.7
     - Pattern recurrence=3+: base score × 0.5
   - **D3 Improvement Action**: previous Improvement Target application + new improvement discovery
   - **D4 Memory Hygiene**: stale info corrections, line count compliance
   - **D5 Work Efficiency**: parallel execution, Agent delegation, dedicated tool compliance rate
3. Eval = average of valid items (exclude N/A)
4. Append new row to eval-scores.md Epoch Log table
5. Analyze change vs previous Epoch
6. If 5+ epochs → update Trend Analysis

### Step 7: Output Summary

Output in the following format:

```
## Checkpoint #{N}: {title}

### Record
- {변경 내용 요약 2-3줄}
- MEMORY.md: {updated or not}
- 미커밋: {warning if any}

### Lessons Applied (self-improvement this session)
| Target file | Change | Rationale |
|-------------|--------|-----------|
| {filename} | {added/modified content} | {which session experience prompted this} |
(if none, output "No new lessons extracted this session")

### User Requests (unexecuted/partially executed)
| Request | Status | Notes |
|---------|--------|-------|
| {request content} | {Issue #N created / Pending / not reflected} | {external URL/resource if any} |
(if all completed as code, output "All user requests completed as code changes")

### Improvement Target
> {specific action to try next session}
(this target will be reminded in next /init Phase 6a-2)

### Session Eval (Epoch {N})
| D1 | D2 | D3 | D4 | D5 | **Eval** |
|----|----|----|----|----|----------|
| {score} | {score} | {score} | {score} | {score} | **{avg}** |
- vs Previous: {Eval change +/-} | {mention Dimension with largest change}
- Lowest: D{N} ({score}) — {one-line improvement direction}

### Memory Health
- troubleshooting.md: {item count} patterns (+{N} new)
- Stale entries fixed: {N}
- MEMORY.md: {current line count}/200
- request-journal.md: {N} entries added (total {total})
- session-log.md: {row count} sessions logged

### Context Usage
{/context 실행 결과 — 사용량/한도, 비율}

```

### Step 8: Context Usage Report

Run `/context` (or equivalent context usage check) at the very end and include the result in the output.

This allows the user to see how much context window remains and decide whether to continue or `/clear`.

**Output format** (append to Step 7 output):
```
### Context Usage
- Used: {N}K / {total}K tokens ({percent}%)
- {if >80%: "⚠️ Context window running low — consider /clear"}
```

If $ARGUMENTS is provided, use as checkpoint title. Otherwise auto-generate from commit messages.

## Lesson Worthiness Criteria

### Conditions for a lesson worth adding
- **Reproducible**: the same situation can recur
- **Non-obvious**: a lesson specific to this project
- **Actionable**: takes the form "next time do X"
- **Verified**: actually confirmed during this session

### What NOT to add
- One-off mistakes (low reproducibility)
- Repetitions of already-recorded patterns (duplicates)
- Speculation or unverified hypotheses
