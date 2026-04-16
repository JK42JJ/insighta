# Git Commit Safety Rule

Before every `git commit`:
1. Run `git status` and verify staged files match intent.
2. If unexpected files are staged:
   - `git restore --staged <file>` to unstage
   - Re-verify with `git status`
3. Only then commit.

## Trigger Context
Commit `a25ef0d` (2026-04-16) leaked 3 non-dataset files into a dataset
purge-log commit:
- frontend/src/pages/index/ui/IndexPage.tsx
- frontend/src/widgets/card-list-view/ui/CardListView.tsx
- src/modules/mandala/manager.ts

Mechanism unclear (lint-staged config standard). Defensive rule above
prevents recurrence regardless of mechanism.

## Memory Migration Target
When user-memory is healthy, this rule should migrate to:
`~/.claude/projects/-Users-jeonhokim-cursor-insighta/memory/feedback-commit-scope-verify.md`
