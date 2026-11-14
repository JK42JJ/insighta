/**
 * Best-cell cosine relevance for the card experiment. Reuses the engine's
 * embedBatch (iks-scorer) + cosineSimilarity (v3 mandala-filter).
 */

import { RELEVANCE_DESC_CHARS } from '@/config/card-experiment';
import { embedBatch } from '@/skills/plugins/iks-scorer/embedding';
import { buildEmbeddingText } from '@/skills/plugins/video-discover/v2/video-embedder';
import { cosineSimilarity } from '@/skills/plugins/video-discover/v3/mandala-filter';
import type { RelevanceScore } from './types';

export interface RelevanceDeps {
  embed: (texts: string[]) => Promise<(number[] | null)[]>;
  cosine: (a: ReadonlyArray<number>, b: ReadonlyArray<number>) => number;
}

const DEFAULT_DEPS: RelevanceDeps = {
  embed: (texts) => embedBatch(texts),
  cosine: cosineSimilarity,
};

/** title + first RELEVANCE_DESC_CHARS chars of description (engine text builder). */
export function buildRelevanceText(title: string, description?: string | null): string {
  return buildEmbeddingText({
    videoId: '',
    title,
    description: (description ?? '').slice(0, RELEVANCE_DESC_CHARS),
  });
}

/**
 * Best-cell cosine + winning cell label per text. cosine is null when the
 * text's embedding failed or no cell embedding is available.
 */
export async function relevanceBestCells(
  texts: string[],
  cellDescriptions: Record<string, string>,
  deps: RelevanceDeps = DEFAULT_DEPS
): Promise<RelevanceScore[]> {
  if (texts.length === 0) return [];
  const labels = Object.keys(cellDescriptions);
  const vectors = await deps.embed([...texts, ...labels.map((l) => cellDescriptions[l] ?? '')]);
  const textVecs = vectors.slice(0, texts.length);
  const cellVecs = vectors.slice(texts.length);

  return textVecs.map((tv): RelevanceScore => {
    if (!tv) return { cosine: null, bestCell: null };
    let best: number | null = null;
    let bestCell: string | null = null;
    for (let i = 0; i < cellVecs.length; i++) {
      const cv = cellVecs[i];
      if (!cv) continue;
      const c = deps.cosine(tv, cv);
      if (best === null || c > best) {
        best = c;
        bestCell = labels[i] ?? null;
      }
    }
    return { cosine: best, bestCell };
  });
}

/** Best-cell cosine per text (null when embedding failed). */
export async function relevanceScores(
  texts: string[],
  cellDescriptions: Record<string, string>,
  deps: RelevanceDeps = DEFAULT_DEPS
): Promise<(number | null)[]> {
  const detailed = await relevanceBestCells(texts, cellDescriptions, deps);
  return detailed.map((d) => d.cosine);
}
