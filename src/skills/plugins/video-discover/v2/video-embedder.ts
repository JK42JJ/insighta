/**
 * video-discover v2 — video embedder
 *
 * Wraps the iks-scorer Qwen3-Embedding-8B client to embed YouTube video
 * (title + description-snippet) text. Reuses `embedBatch` chunking and
 * `isOllamaReachable` health probe so the v2 executor can degrade to the
 * even-distribution fallback when the Mac Mini is unreachable.
 *
 * Output: Map<videoId, number[]> with 4096-dim L2-normalized vectors.
 * Videos with no embedding (chunk failure, missing index) are silently
 * dropped from the map — caller treats them as "unscored".
 */

import {
  embedBatch,
  isOllamaReachable,
  type EmbeddingClientOptions,
} from '../../iks-scorer/embedding';
import { logger } from '@/utils/logger';

const log = logger.child({ module: 'video-discover/v2/video-embedder' });

/** Hard cap on text length per video (title + description snippet). */
export const MAX_EMBED_TEXT_LENGTH = 500;

export interface VideoForEmbedding {
  videoId: string;
  title: string;
  description?: string;
}

export interface EmbedVideosResult {
  embeddings: Map<string, number[]>;
  ollamaReachable: boolean;
  /** Number of input videos that successfully received an embedding. */
  embeddedCount: number;
}

/**
 * Concatenate title + description, capped at 500 chars. Keep title intact;
 * truncate description to fit. Whitespace-collapsed for embedding stability.
 */
export function buildEmbeddingText(video: VideoForEmbedding): string {
  const title = (video.title ?? '').trim();
  const desc = (video.description ?? '').trim();
  if (!title && !desc) return '';
  if (!desc) return title.slice(0, MAX_EMBED_TEXT_LENGTH);
  const joined = `${title}. ${desc}`.replace(/\s+/g, ' ').trim();
  return joined.slice(0, MAX_EMBED_TEXT_LENGTH);
}

/**
 * Embed videos in chunks. If Ollama is unreachable, returns an empty map
 * with `ollamaReachable=false` so the caller can switch to even fallback.
 * Throws only on programmer error (bad shape) — transport failures degrade.
 */
export async function embedVideos(
  videos: VideoForEmbedding[],
  opts: EmbeddingClientOptions = {}
): Promise<EmbedVideosResult> {
  if (videos.length === 0) {
    return { embeddings: new Map(), ollamaReachable: true, embeddedCount: 0 };
  }
  const reachable = await isOllamaReachable(opts);
  if (!reachable) {
    log.warn(`Ollama unreachable — skipping ${videos.length} video embeddings`);
    return { embeddings: new Map(), ollamaReachable: false, embeddedCount: 0 };
  }

  const texts = videos.map(buildEmbeddingText);
  let vectors: number[][];
  try {
    vectors = await embedBatch(texts, opts);
  } catch (err) {
    log.warn(`embedBatch failed: ${err instanceof Error ? err.message : String(err)}`);
    return { embeddings: new Map(), ollamaReachable: true, embeddedCount: 0 };
  }

  const map = new Map<string, number[]>();
  for (let i = 0; i < videos.length; i++) {
    const vec = vectors[i];
    const v = videos[i];
    if (vec && v) map.set(v.videoId, vec);
  }
  return { embeddings: map, ollamaReachable: true, embeddedCount: map.size };
}
