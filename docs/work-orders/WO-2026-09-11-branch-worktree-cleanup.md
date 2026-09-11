---
id: WO-2026-09-11-branch-worktree-cleanup
status: running
owner: insighta-session
opened: 2026-09-11
---

# 목표
작업 흔적이 저절로 지워지게 한다. 방치 브랜치 · 워크트리가 0 이 되고, 다시 쌓이지 않는 규칙이 걸린다.

# 맥락
실측 2026-09-11: 원격 브랜치 541 refs(prune 후 머지됨 2 · 30일 이상 미머지 28) · 워크트리 14(dirty 5). `docs/ops/working-method-2026-09-11.md` §4.

# 제약
- 되돌릴 수 있는 것만 자동: 머지된 원격 브랜치 삭제, dirty=0 이고 이 세션 소유 또는 서브에이전트가 만든 워크트리 제거.
- 미머지 30일+ 브랜치 28개와 dirty 워크트리 5개는 목록만 만들고 James 결정(삭제 = 되돌릴 수 없음).

# 검증 기준
- [x] `git branch -r --merged origin/main | grep -v main` → 0 (2026-09-11 21:23 KST 실측; 원격 56 중 머지분 0)
- [ ] `git worktree list` → 서브에이전트 워크트리 0 — 실측 11 중 1(`.claude/worktrees/book-compression`, 미커밋 1 → QUESTIONS 2행)
- [x] 미머지 28개 목록이 QUESTIONS 에 올라감

# james
- 미머지 30일+ 브랜치 28개 삭제 여부.
- dirty 워크트리 5개(primary 69 · loading-fouc 2 · chatbot-rollback 1 · note-toolset 1 · book-compression 1) 의 미커밋 변경 처리.

# restated
머지된 원격 브랜치와 깨끗한 서브에이전트 워크트리는 내가 지우고, 미머지·미커밋은 목록으로 올린다.

# 결과
2026-09-11 (자율 루프 2차, 21:23 KST 실측)
- 머지된 원격 브랜치 0. 이번 세션이 만든 브랜치 5개(#1633 · #1634 · #1635 · #1636 · #1638 · #1639)는 머지 시 삭제됨. 워크트리 14 → 11(서브에이전트 2 + 머지된 docs 워크트리 1 제거).
- 남은 것은 전부 James 결정: 미머지 30일+ 28개(되돌릴 수 없는 삭제) · 미커밋 워크트리 5개. 답이 오기 전까지 running.
