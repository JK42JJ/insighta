/**
 * v3 discover semantic-gate embed-text mode (iv-A, 2026-07-10).
 *
 * `title` (default) = legacy: the gate embeds candidate TITLES only.
 * `title_desc` = embed title+desc[:200], byte-identical to how
 * video_pool_embeddings was built — this reconciles the two representation
 * rules that had diverged (Tier1 KNN + collector already serve on title+desc
 * vectors; the title-only gate was the exception) and makes the 39,350-row
 * pool reusable as a candidate-embed cache (iv-A.2).
 *
 * SEPARATE flag from the (B) async-resort gate (supervisor condition 1): one
 * deploy, but flips independently — never one flip, two variables. Ranking
 * delta (esp. niche desc-noise) is measured before flip (condition 2).
 *
 * Tuning knob, not a secret (CP392). Unset = `title` = current behavior
 * (no-op → flag alone rolls back).
 */
import type { GateEmbedTextMode } from '@/skills/plugins/iks-scorer/embed-text';

export function getGateEmbedTextMode(env: NodeJS.ProcessEnv = process.env): GateEmbedTextMode {
  return String(env['GATE_EMBED_TEXT'] ?? '')
    .trim()
    .toLowerCase() === 'title_desc'
    ? 'title_desc'
    : 'title';
}
