# Wizard goal-embed off the critical path (CP499)

**Status:** DESIGN — review before implementation. No PR yet.
**Author:** CC, reviewed by James.

## Problem (measured)

The wizard's "비슷한 템플릿" / structure-gen path is gated by a **synchronous goal embed**:

```
searchMandalasByGoal (search.ts:288):
  const queryVector = await embedGoalForMandala(goalText);   // ~3.7s, BLOCKS (OpenRouter qwen3-embedding-8b)
  ... cosine over 2001 pre-vectorized template rows ...      // ms (warm 24ms / cold 3.74s)
```

- The **2001 templates are already vectorized** in `mandala_embeddings`; the **only live computation is the user-goal vector** — and that 3.7s is the whole wait.
- The embed is timed **at submit, on the critical path**. There is **no pre-embed during typing**.
- Two consumers, **neither needs to block**:
  - **FE "비슷한 템플릿"** — a *suggestion* section (`isResultsView`), not a gate; the user can still pick the AI card / proceed.
  - **merged-gen reference** (`generator.ts:752`, `mandala-with-queries-generator.ts:43`) — **optional few-shot**: `const example = reference ? ... : ''`; the prompt works zero-shot.
- Cost path to the 30s: each search ≈ embed 3.7s + cosine (cold 3.74s) ≈ **7.4s, just under the 8s `SEARCH_DELAY_MS` "오래 걸림" threshold**. An OpenRouter embed spike or cold cosine over the (gradually grown) 2001-row set crosses 8s → "오래 걸림" → **manual retry → another slow search → cascade → 30s**. (No single in-window commit broke it; gradual table growth crossed a stable threshold.)

## Principle

**The goal-embed must never block a user-facing path.** It runs **async, overlapping the user's typing**; both consumers use the vector **if ready, else proceed without it**. The cache is the storage that lets the pre-embed result be reused (it is NOT the fix on its own).

## Design

### 1. Pre-embed during typing (the core move)
- FE: on goal `onChange`, **debounce ~700ms** after typing stops, then call a server **pre-embed endpoint** (`POST /mandalas/precompute-goal-embed` or reuse `/search-by-goal` warming) which computes + **caches** the goal vector.
- **Debounce rationale:** typeahead uses 250ms (cheap substring); the embed is 3.7s + OpenRouter cost, so 250ms would embed every keystroke-pause (waste). ~700ms ≈ "finished a word/thought"; the embed then has a head start while the user reads templates / thinks before submitting (typically several seconds), so it completes off the critical path.
- **Last-only:** each new keystroke **aborts the in-flight pre-embed** (`AbortController`) — only the latest goal text is embedded; no pile-up, no wasted spend.
- **Min-length gate:** only pre-embed when the trimmed goal ≥ 4 chars (skip partial/meaningless input).
- Result lands in the cache (§5).

### 2. Submit-time fallback (pre-embed is an optimization, never a dependency)
- At submit, `embedGoalForMandala` checks the cache:
  - **Cache hit** (pre-embed finished during typing) → instant → cosine (ms) → results fast.
  - **Cache miss** (user submitted before the pre-embed finished) → embed at submit **as today, but the FE search is non-blocking** (§3) → the suggestion fills in late; the wizard never stalls.
- So a missed pre-embed degrades to "suggestion arrives a few seconds late," never "wizard blocked / 오래 걸림."

### 3. FE suggestion = non-blocking async (kills the cascade structurally)
- Render the wizard results view **immediately** (AI grid, proceed affordances) without waiting on the similar-templates search.
- The "비슷한 템플릿" section shows a **subtle inline pending state** (not a blocking "오래 걸리고 있어요 / 다시 시도" on the path), fills in when the search resolves.
- **If it never resolves** (slow/failed): after a bounded wait, **silently hide the section** (it's a suggestion). **No retry button on the critical path** → the manual-retry cascade cannot form.
- Removes `isSearchSoftSlow`-driven "오래 걸림" + `retrySearch` from the blocking flow (keep `retrySearch` only as a manual, clearly-optional affordance if desired — not auto, not on the path).

### 4. merged-gen reference = opportunistic
- merged-gen reads the cache for the goal vector:
  - **Cached** → run the cosine, include the few-shot `reference` (better structural consistency).
  - **Not cached** → **proceed zero-shot** (omit reference). The prompt is graceful (`example = ''`).
- **Never block structure-gen on the embed.** The reference is a quality nicety, not a requirement.
- **Quality (Hard-Rule-safe):** a synthetic with/without-reference A/B requires OpenRouter generation calls → **forbidden** (LLM-API testing ban, 2026-04-15). So:
  - **Conservative gate:** never trade quality when free — cached → include reference; not-cached → zero-shot ONLY to avoid blocking.
  - **Prod telemetry, not synthetic A/B:** add a `had_reference` flag to `generation_log` (already records validity / sub_goal count / action_unique_rate) → observe the real zero-shot-vs-few-shot quality diff from prod traffic. If prod shows zero-shot materially worse, gate harder (embed-at-create for the not-cached case). A clean controlled number, if wanted, is a CC-console / human-run task — not a CC LLM call.

### 5. Cache as storage (folds in the #878 work, not a standalone merge)
- `TtlLruCache<string, number[]>` keyed by `${provider}:${goalText.trim()}` (provider so a `MANDALA_EMBED_PROVIDER` flip never serves a stale-provider vector; `lang` excluded — it affects only the cosine filter, not the embed).
- Size 256 (~8MB at ~32KB/vector), TTL 5min (memory bound only — the vector is goal-deterministic, never stale). The cosine is **not** cached → results stay fresh as `mandala_embeddings` is written.
- Written by the pre-embed (§1); read by submit (§2), FE search, and merged-gen (§4).

## Implementation plan (phased, each its own PR, per-step approval)

**Order: A → C → B → D** (C prioritized — see rationale below).

| PR | scope | rollback unit |
|----|-------|---------------|
| **A — cache storage** | `TtlLruCache` util + `embedGoalForMandala` cache (= the #878 work, re-scoped as the storage component). BE-only. | the cache |
| **C — non-blocking suggestion** | FE: render results immediately; suggestion async + hide-if-absent; remove "오래 걸림"/auto-retry from the path. FE-only. | the FE UX |
| **B — pre-embed trigger** | server pre-embed endpoint + FE debounced (700ms) / abort-last / min-len pre-embed call on typing. FE+BE. | the pre-embed |
| **D — opportunistic reference** | merged-gen reads cache; conservative gate (cached→include, not-cached→zero-shot) + `had_reference` telemetry. BE-only. | the reference logic |

- **Why C before B:** C is the **deterministic** cascade-kill — removing "오래 걸림"/auto-retry from the path means the 30s cascade *cannot form*, regardless of embed speed. A·B are **probabilistic** latency reductions: a cache-miss + cold cosine + an OpenRouter embed spike can still cross the 8s threshold → "오래 걸림" → cascade *if C isn't done*. So A·B alone can't guarantee the 30s is gone; **C is the guarantee.**
- **A** is safe + foundational (no behavior change beyond dedupe; basically #878-ready). **C** kills the 30s. **B** makes the first search fast. **D** removes the embed from the create path.
- Each PR: implement → /verify → diff → per-step merge. FE PRs (B partial, C) need browser smoke.

## Verification (per phase + end-to-end)
- A: cache hit/miss/TTL/LRU unit tests (done in #878).
- B: prod log — pre-embed fires on typing pause; submit hits cache (embed once per goal, during typing).
- C: a slow/failed search never shows "오래 걸림" on the path + never blocks proceeding; no retry cascade.
- D: structure-gen quality with vs without reference (the §4 open check).
- End-to-end: wizard goal→results stays well under 8s even on a fresh goal + cold cosine; no retry cascade; create path carries no embed.

## Open items (resolve before/within the relevant PR)
1. **§1 debounce value** — 700ms is the proposal; tune against real typing cadence + OpenRouter cost.
2. **§4 reference quality** — measure zero-shot vs few-shot structure quality before always-omitting.
3. Whether to keep a manual (non-path) "다시 시도" for the suggestion, or drop it entirely.
