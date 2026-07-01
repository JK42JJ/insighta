# G3 W1① — Pool embedding backfill: design (execution = James gate)

> 2026-07-01. CC-autonomous scoping + dry-sanity design per Claude-web handoff.
> **Execution (Mac Mini embed run + prod `video_pool_embeddings` write + dry run)
> = James gate** — CLAUDE.md HARD RULE (bulk = Mac Mini CC CLI + test-first
> verify-one 5-stage + dry→small→full) + prod side-effect. CC does NOT run it.
> This doc leaves the track at "open the gate → execute" state.

## Baseline (G2-b, confirmed) — the before/after reference
Golden-cohort full gc: **median 76 / %<65 21% / n=419** (cache 274 + Haiku 145,
cap30 ≈$0.7). `search_metrics_daily` `run_type=golden_cohort`. cacheOnly 78 is a
biased value — **discarded**; the 76 (with the previously-unmeasured bad mandalas
folded in) is the SSOT baseline. **daily-coding-en gc=35 (%<65 74.3) = the outlier
+ the first litmus target** for whether embedding backfill helps.

## SSOT (verified read-only — no guessing)
- **Model = `qwen3-embedding-8b`** (Mac Mini Ollama, `vector(4096)`), uniform across
  all rows → this defines the cosine space. Same model that made the existing ~5,711.
- **Input = source-specific `buildEmbedText`** (this is data-nature, not a mismatch):
  - `v2_promoted` → `title + one_liner + core_argument` (promote-from-v2.ts:83)
  - `yt_promoted` / `playlists` → `title + description` (promote-from-youtube-videos.ts:89, promote-from-playlists.ts:75)
  - → the backfill routes each unembedded row through **its source's existing
    buildEmbedText** = SSOT-consistent. **No new embedding code.**
- **Idempotent**: `INSERT INTO video_pool_embeddings (video_id, embedding, text_input, model_version)
  … ON CONFLICT (video_id, model_version) DO NOTHING`.
- **Reuse embedder**: `embedBatch(inputs, { baseUrl })` + `isOllamaReachable(...)` from
  `@/skills/plugins/iks-scorer/embedding` (the exact call promote-from-* uses).

## Selector — unembedded active gold/silver (dry-confirmed = 7,022)
> ⚠️ **model_version is `qwen3-embedding:8b` (COLON)**, NOT `qwen3-embedding-8b`
> (dash = the schema DEFAULT, never actually written). The promote INSERT uses
> `QWEN3_EMBED_MODEL = 'qwen3-embedding:8b'`. Dry-sanity CAUGHT this: a dash
> filter matched 0 existing rows → mis-counted 11,482 "unembedded"; the colon
> value (n=32,234 all rows) gives the true **7,022** unembedded (= horizon-0's
> ~7,023). Using the dash for the backfill would have re-embedded ~4,460 already-
> embedded rows under a split model_version → cosine-space fracture (prod incident).
```sql
SELECT vp.video_id, vp.source, vp.quality_tier
FROM video_pool vp
WHERE vp.is_active = true
  AND vp.quality_tier IN ('gold','silver')
  AND NOT EXISTS (
    SELECT 1 FROM video_pool_embeddings e
    WHERE e.video_id = vp.video_id AND e.model_version = 'qwen3-embedding:8b'
  );
```
(Re-confirm the count at run time — the pool grows; dry run measured 7,022.)

## Dry-sanity RESULT (2026-07-01, executed) — PASS (space match confirmed)
- Mac Mini Ollama up (`qwen3-embedding:8b` present); 31 stratified samples embedded.
- New-embed max_cos vs golden-cohort cells: **med 0.462, max 0.700** (per source:
  v2 0.33-0.56 / yt 0.34-0.55 / user_curated 0.39-0.70).
- **Control** (EXISTING embedded pool rows vs same cohort cells): **med 0.405, max
  0.493**. New ≥ existing baseline ⇒ same cosine space, **mismatch ruled out**. The
  ~0.46 median is normal (random pool rows vs the 10 cohort mandalas' specific cells).
- Uniform ~0.1 (mismatch) NOT seen. Dim 4096 both sides. → **backfill space-safe.**

## Backfill script design (scaffold — not executed)
1. **Load** the selector rows (batched, e.g. 200/batch), ordered by video_id for
   deterministic resume.
2. **Per row, route by `source`** → fetch the source-appropriate text fields and
   call that source's `buildEmbedText`:
   - `yt_promoted` (dominant): join `youtube_videos` (title, description).
   - `v2_promoted`: join `video_rich_summaries`/v2 (yv_title, one_liner, analysis.core_argument).
   - `playlists`: title + description from its source table.
3. **Embed** the batch via `embedBatch(inputs, { baseUrl: ollamaUrl })` (Mac Mini
   Ollama). `isOllamaReachable` guard first; on unreachable → stop (do not promote
   without embeddings for a backfill whose entire purpose is embeddings).
4. **Insert** each `(video_id, vec, text_input, 'qwen3-embedding-8b')` with
   `ON CONFLICT DO NOTHING` (idempotent → safe to re-run / resume).
5. **Resume**: skip rows already embedded (the selector's `NOT EXISTS` handles this
   automatically on restart). **Progress**: log `embedded/total` per batch.
6. **YouTube quota = 0** (embedding only; no search.list).

## Dry-sanity procedure (DESIGN only — execution = James gate)
Purpose: a **gate** — confirm new embeddings land in the SAME cosine space as the
existing ones before committing 7k. Ambiguous distributions are a James/supervisor
call, NOT a CC-solo pass.
1. Take a **small sample** (e.g. 20-30) of unembedded rows, embed via Mac Mini.
   **★ Stratify the sample by `source`** (or mix a few per source) and report
   max_cos **per source** — v2_promoted (rich input) tends to score higher, yt/
   playlists (title+desc) lower. If the sample skews to one source, an "ambiguous
   0.3~0.4" can't be told apart from a real mismatch vs just a yt-heavy sample.
2. For each, compute **max cosine vs the golden-cohort cell embeddings**
   (`mandala_embeddings` for the 10 cohort mandalas).
3. **Pass criterion**: distribution resembles the existing rows' — **some in
   0.5~0.75** (real matches present). **Fail (STOP 7k)**: uniformly low (~0.1)
   across all cells = model/input mismatch → investigate before any bulk write.
4. **Ambiguous (e.g. 0.3~0.4)** → do NOT auto-decide; surface to James/supervisor.
5. Sample embeddings may be measured **without persisting** (compute cosine in
   memory) OR persisted (idempotent) — James decides at run time.

## James-gate execution order (on return)
1. **[James]** confirm Mac Mini Ollama up (Tailscale `100.91.173.17`, qwen3-embedding:8b) + selector count.
2. **[James/CC-under-gate]** dry sanity (20-30 sample) → max_cos distribution.
3. **[James/supervisor]** judge distribution: pass (0.5~0.75 present) / fail (uniform ~0.1) / ambiguous → decide.
4. **[James]** pass → small batch → full 7,023 → prod write (verify-one 5-stage + dry→small→full).
5. **[Done]** James full gc re-run on the golden cohort → prove coverage/gc rise
   (esp. **daily-coding-en gc35**) vs **full baseline 76** (NOT cacheOnly), n=419 same cohort.
   → activate the `coverage.cosine_coverage` metric (the follow-up) here.

## daily-coding-en gc35 — litmus (not a side investigation)
Worst in baseline. After backfill + full gc re-run:
- gc35 **rises** → embedding absence was the cause (recovery works).
- gc35 **stays ~35** → not embedding = en coding pool absent (→ W3 targeted
  collection) or off-lang / query-gen → investigate separately then.
The before/after gc auto-diagnoses the cause.

## Invariants
Bulk / dry / prod write = James gate · embedding model+input SSOT (per-source
existing fn) · no new embedding code · Ollama infra no unattended wake · measure
read-only · node_modules untouched · Done = James full gc re-measure.
