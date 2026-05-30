# README Rewrite — Rationale SSOT [CP490+]

**Date**: 2026-05-30
**Branch**: chore/readme-public-essentials-cp490
**Owner**: JK
**Scope**: This document is the rationale SSOT for **all public-facing
surface content** (README, landing page, X/Twitter, marketing, demo video
descriptions). The README is the first concrete application; the rules
below apply to every other surface without re-derivation.

---

## §0 Why this doc exists

Past public-surface edits violated the essentials-only rule **3+ times**.
Memory-only enforcement failed — the next session forgets. This doc is the
in-repo, git-blamed, durable record:

- **Layer A** (in-file): the README's top HTML comment lists `forbidden — WHY`
  pairs
- **Layer B** (this doc): full rationale + violation history + rule update
  path + self-audit meta-rule

When a rule needs to relax or tighten, update this doc *first*, then sync
the HTML comment per §3.

---

## §1 Violation history

| Date | Surface | Violation | Why bad |
|---|---|---|---|
| ~2026-05-29 | (memory consensus) | An early PR proposed keeping `mac-mini/**` in the public repo as an "operational dependency" | Operator infra exposed |
| 2026-05-30 | `README.md` Stack line | `Mac Mini worker (youtube-transcript-api + claude -p, Tailscale-bound)` | Transcript tool + hostname + VPN — three NEVER categories at once |
| ongoing | `docs/OPERATIONS.md` | EC2 IP / `.pem` / instance id present | Separate scope, addressed elsewhere |

---

## §2 Rules — `forbidden` with **WHY**

### R1. Transcript-fetching mechanism
**Forbidden**: tool names, libraries, call paths — `youtube-transcript-api`,
`yt-dlp`, "caption pipeline", "transcript fetch", etc.
**WHY**: voluntarily disclosing a ToS gray-zone hurts YouTube Data API
review and creates quota-revocation risk. Public git history is permanent —
once shipped, you cannot retract.
**Allowed substitute**: "transcript processing worker" (tooling and method
not disclosed).

### R2. YouTube positioning
**Forbidden**: any phrasing that implies "transcript stored", "captions
retained", "caption ingest".
**WHY**: invites storage and copyright liability. The safe line for API
review is "metadata only".
**Required stance**: "metadata only, transcript not stored".

### R3. Operator topology
**Forbidden**: Mac Mini, Tailscale, `claude -p`, EC2 IP, instance id,
`.pem`, SSH commands.
**WHY**: production topology is attack surface. Zero value to a reviewer,
significant reconnaissance value to an attacker.
**Allowed**: high-level abstraction such as "EC2 + Docker + Nginx".

### R4. Internal identifiers
**Forbidden**: internal PR numbers, commit hashes, absolute cost figures,
user quotes.
**WHY**: leaks internal collaboration and negotiation context. Zero value
to a README reader.
**Allowed**: generalized phrasing ("recent PR", "manageable cost").

### R5. v4 LLM-arbiter framing
**Forbidden**: "production", "shipped", "live", "in operation" — and any
equivalent paraphrase of the same claim.
**WHY**: not currently deployed to production; still under measurement.
A false claim will be caught the moment a reviewer opens the code, and
trust is gone.
**Allowed**: "exploration", "under measurement", "PoC".

### R6. Structure — differentiation before stack
**Forbidden**: placing the Stack line on the first screen (right after the
h2 / first paragraph).
**WHY**: a reviewer's first impression becomes "another CRUD app". Stack
is meaningful only *after* differentiation and design decisions.

---

## §3 Rule update path

When a rule relaxes or tightens:

1. **Identify the premise that changed** (e.g., repo went private, YouTube
   API review completed with explicit transcript policy, v4 reached prod).
2. **Update the WHY line in §2.Rx of this doc.**
3. **Sync the README HTML comment 1:1** — must match this doc.
4. **Commit message must include `Updates: docs/handoffs/readme-rewrite-cp490.md §Rx`**
   so git blame can trace the rule change to its rationale.

**Example — repo goes private**:
- R3 (operator topology) can relax (attack-surface concern drops).
- R1, R2 (transcript / YouTube positioning) stay — API review risk
  unchanged.
- R4 (internal identifiers) can partly relax.
- R5 (v4 framing) stays — this is an accuracy concern, not a confidentiality
  one.

---

## §4 Out of scope

- Tidying `docs/OPERATIONS.md` — separate scope.
- Reviewing whether `docs/VISION.md` is appropriate for public — separate
  audit (currently judged OK to keep public).
- Public-appropriateness audit of `docs/design/*` — separate audit.

---

## §5 Related pointers

- `memory/feedback_public_repo_essentials_only.md` — the parent HARD RULE.
- `~/.claude/CLAUDE.md` — Hard Rules section.

---

## §6 Change log

| Date | Change | By |
|---|---|---|
| 2026-05-30 | Initial draft (CP490+). Includes §7 self-audit meta-rule. | CC + JK handoff |

---

## §7 Self-audit principle — keyword ❌, semantics ✅

CP490+ lesson: grep-ing for forbidden *keywords* misses the **same violation
phrased differently**. This failure mode is the direct reason §7 exists.

**Wrong**: "no `v4` token found → R5 passes."
**Right**: "no `v4`, no equivalent renaming of the same feature (LLM-arbiter
/ LLM-picker / model scoring / candidate comparison / etc.), AND the claim
is reconciled against the code's ground truth (deployed vs exploratory)
before the line is written."

### Audit checklist (mandatory before any edit)

1. For each rule in §2 (R1–R6), brainstorm **at least three** paraphrases
   that would convey the same forbidden meaning, then grep for all of them.
2. Every feature name in the Design decisions / differentiation sections
   must be **verified against code** — path exists, env exists, production
   deployment status confirmed.
3. Anything exploratory / unshipped / not yet built is described with
   "exploration" or "planned" framing. Only deployed-and-running features
   may be stated as fact.
4. **Reviewer simulation**: imagine a reviewer opening the code after
   reading this line. Where would they catch a falsehood? If anywhere, soften
   the line.

### CP490 self-catch failure (case study)

- First self-audit: Draft B's "Add Cards = LLM-pick" item was marked "✓".
- Meta-violation: the audit had only grepped for the R5 keyword `v4`. It
  did not consider that "LLM-pick" might be another label for the same
  feature family.
- Post-hoc verification: v5 is a distinct path from v4 (single picker vs
  three-model arbiter), shipped via PR #802 → deploy success → user
  verified. The claim happened to pass R5, but the audit's reasoning chain
  was keyword-based and would have missed a true violation phrased the same
  way.
- Lesson: even when the result is correct, a keyword-only audit will fail
  next time. §7 upgrades the *method* itself.

### Scope of this meta-rule

Applies to all of R1–R6, and inherits automatically to any future R7+.
