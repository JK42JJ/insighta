# Branch Hygiene Device — Design SSOT [CP490+]

**Date**: 2026-05-30
**Branch**: chore/branch-hygiene-device-cp490
**Owner**: JK

## §0 Why this doc exists

Past pattern: branches accumulate across sessions because memory-only "I'll
clean up later" enforcement fails. Proven at CP490 by a 92→7 one-shot
mass-cleanup that should never have been needed.

This doc captures the **device architecture** so any future CC session on
any machine can recreate the per-machine pieces (`/save` Step 3.5, the
audit script) from spec — those files live outside the repo (`.claude/`
and `scripts/*` are gitignored per the public-essentials-only rule).

The only piece of state that **must** be in the repo is `.branch-wip.json`,
because it carries the cross-machine list of protected branches.

---

## §1 Architecture

```
┌────────────────────────────────────────────────────────┐
│  L1  GitHub repo setting (cross-machine, in-platform)  │
│      "Automatically delete head branches" = ON         │
│      Prevents future merge → dangling accumulation.    │
└────────────────────────────────────────────────────────┘
                          ↓
┌────────────────────────────────────────────────────────┐
│  L2  /save Step 3.5 (per-machine, .claude/ — gitignored)│
│      Session-end branch responsibility prompt.         │
│      Forces (a/b/c/d) disposition before /save finishes.│
└────────────────────────────────────────────────────────┘
                          ↓
┌────────────────────────────────────────────────────────┐
│  L5  scripts/branch-audit.sh (per-machine, gitignored) │
│      On-demand classification + optional bulk delete.  │
│      Reads .branch-wip.json to skip protected entries. │
└────────────────────────────────────────────────────────┘
                          ↑
┌────────────────────────────────────────────────────────┐
│  .branch-wip.json (cross-machine, committed to repo)   │
│      Single source of truth for "protected" branches.  │
│      Both L2 and L5 honor it.                          │
└────────────────────────────────────────────────────────┘
```

L2 deferred-and-replaced (was: weekly stale-branch issue). Auto-issue
creation only moves dirt from branches to issues — discipline at the
action moment (`/save`) catches the editor while context is still loaded.

---

## §2 `.branch-wip.json` schema

```json
{
  "wip_branches": [
    {
      "branch": "<name>",
      "target_date": "YYYY-MM-DD | null",
      "reason": "<one-line>",
      "registered_at": "YYYY-MM-DD"
    }
  ]
}
```

- `target_date: null` is allowed for indefinitely-protected branches but
  L2 should re-prompt for a concrete date at every /save until one is set.
- L5 surfaces entries whose `target_date < today` under category **E**
  (expired) for review.

---

## §3 L2 — `/save` Step 3.5 spec

Insert into `.claude/commands/save.md` immediately before "Step 4: Memory
Hygiene Check".

```markdown
### Step 3.5: Branch Responsibility Check (CP490+)

Procedure:
1. `git branch --show-current` → if main, skip.
2. Read `.branch-wip.json`. If current branch is in `wip_branches`,
   skip the prompt.
3. `gh pr list --head <branch> --state all --json number,state,mergedAt --jq '.[0]'`.
4. Emit:
       Current branch: <name>
       PR state: <NONE | OPEN #N | MERGED #N | CLOSED #N>

       What is the disposition?
         (a) MERGED in this session — already auto-deleted by --delete-branch
         (b) PR OPEN — note PR# (no action)
         (c) WIP, will continue — append to .branch-wip.json {target_date, reason}
         (d) ABANDONED — delete remote + local NOW
5. (c) requires target_date. Empty target_date → refuse (c), force (a/b/d).
6. (d) executes deletion inline (no defer).
7. Re-scan .branch-wip.json for expired target_dates → re-prompt each.
8. Refuse to advance to Step 4 without a disposition for current branch
   and every expired WIP entry.
```

---

## §4 L5 — `scripts/branch-audit.sh` spec

Categories computed from `gh pr list --head <branch>`:

| | Meaning | Action |
|---|---|---|
| M | MERGED via PR (squash-shipped) | safe to delete |
| C | CLOSED PR without merge | safe to delete |
| O | OPEN PR | keep |
| W | listed in `.branch-wip.json`, `target_date >= today` | keep |
| E | listed in `.branch-wip.json`, `target_date < today` | review |
| N | no PR ever | review |

Modes:
- `--report` — print categorized table, no mutation (default)
- `--list-stale` — only print categories E + N
- `--delete-merged` — interactive bulk-delete M + C remotes after `[y/N]` confirm
- `--days N` — override stale-day threshold (default 30) for category N

Implementation notes:
- Filter out `origin` (the bare HEAD shortened ref) explicitly.
- Use nounset-safe array expansion: `${ARR[@]+"${ARR[@]}"}`.
- `git push origin :refs/heads/<br>` for multi-branch single-push delete.
- Never delete branches in O or W.

---

## §5 Rule update path

- If GitHub introduces native session-end branch checks → L2 can be retired.
- If `.branch-wip.json` exceeds 20 entries → fold review into a regular
  /retro Step instead of every /save.
- If a machine's CC config lacks Step 3.5 (e.g., fresh checkout) → CC
  recreates it from §3 of this doc on first /save invocation.

---

## §6 Related

- `memory/feedback_public_repo_essentials_only.md` — explains why L2/L5
  files stay local (`.claude/` and `scripts/*` gitignored).
- `docs/handoffs/readme-rewrite-cp490.md` — sibling handoff doc with the
  same 2-layer in-file/in-repo pattern.
