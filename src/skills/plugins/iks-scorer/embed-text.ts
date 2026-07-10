/**
 * Canonical video embed-text builder (SSOT) — 2026-07-10.
 *
 * The embedding of a video's text is a GLOBAL property keyed by video_id, so
 * every path that embeds a video MUST build byte-identical input:
 *   - batch-video-collector → populates video_pool_embeddings (39,350 rows),
 *   - v3 discover semantic gate → (iv-A) reuses those pooled vectors.
 * If a cache hit (pooled vector) and a live embed for the SAME video used a
 * different text rule, the two vectors would differ subtly and silently skew
 * ranking. This is the ONE definition; both callers import it.
 *
 * Rule (UNCHANGED — this is exactly what built the pool, so a title_desc gate
 * embed is byte-identical to the pooled vector): title, newline, description
 * truncated to EMBED_DESC_SNIPPET_LEN. Title alone when there is no
 * description. No trim / whitespace-collapse (the pool did not do it either).
 */
export const EMBED_DESC_SNIPPET_LEN = 200;

/** `${title}\n${desc[:200]}` (or just title when no desc). Byte-identical to the pool. */
export function buildVideoEmbedText(title: string, description?: string | null): string {
  const t = title ?? '';
  const desc = (description ?? '').slice(0, EMBED_DESC_SNIPPET_LEN);
  return desc ? `${t}\n${desc}` : t;
}

export type GateEmbedTextMode = 'title' | 'title_desc';

/**
 * The text to embed for one discover candidate under the given gate mode.
 * `title` (default) = legacy title-only gate. `title_desc` = the pool-aligned
 * text so pooled vectors become reusable (iv-A). Center-goal embeds are NOT
 * routed through here — only video candidates.
 */
export function candidateEmbedText(
  mode: GateEmbedTextMode,
  title: string,
  description?: string | null
): string {
  return mode === 'title_desc' ? buildVideoEmbedText(title, description) : (title ?? '');
}
