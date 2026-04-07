/**
 * iks-scorer — embedding client (Phase 2b)
 *
 * Calls Mac Mini Ollama (`http://100.91.173.17:11434`) with model
 * `qwen3-embedding:8b` to produce 4096-dim L2-normalized vectors.
 *
 * Why a dedicated client (instead of reusing OllamaEmbeddingProvider):
 *  - The existing provider is hardcoded to `OllamaEmbeddingProvider.dimension = 768`
 *    (nomic-embed-text). Phase 2b uses a different model on a different host.
 *  - Plugin architecture §6 forbids cross-plugin imports — keeping this in
 *    `src/skills/plugins/iks-scorer/` enforces ownership.
 *  - The Mac Mini host is configured per-plugin (not via global config) so
 *    other skills don't accidentally hit it.
 *
 * Phase 2b also exposes `cosineSimilarity()` and `loadGlobalCentroid()` —
 * the latter pulls level=1 mandala_embeddings rows from local DB and
 * averages them to a single 4096d vector representing "what learning
 * goals look like in the mandala universe". Cosine sim with that centroid
 * is the goal_relevance signal at IKS scoring time.
 */

import { logger } from '@/utils/logger';
import { getPrismaClient } from '@/modules/database';
import { Prisma } from '@prisma/client';

const log = logger.child({ module: 'iks-scorer/embedding' });

export const QWEN3_EMBED_MODEL = 'qwen3-embedding:8b';
export const QWEN3_EMBED_DIMENSION = 4096;
export const MAC_MINI_OLLAMA_DEFAULT_URL = 'http://100.91.173.17:11434';
const HEALTH_CHECK_TIMEOUT_MS = 3000;
const EMBED_TIMEOUT_MS = 60000;
/**
 * Embed chunk size — Mac Mini M4 handles ~50 texts in ~10s comfortably.
 * 456 texts in one call exceeds 60s timeout. Chunking gives predictable
 * per-call latency.
 */
const DEFAULT_EMBED_CHUNK_SIZE = 50;

export class EmbeddingError extends Error {
  constructor(
    message: string,
    public readonly httpStatus?: number
  ) {
    super(message);
    this.name = 'EmbeddingError';
  }
}

export interface EmbeddingClientOptions {
  /** Override base URL. Defaults to MAC_MINI_OLLAMA_DEFAULT_URL. */
  baseUrl?: string;
  /** Override model. Defaults to QWEN3_EMBED_MODEL. */
  model?: string;
  /** Override chunk size. Defaults to 50 (proven safe on Mac Mini M4). */
  chunkSize?: number;
  /** Injectable fetch for testability. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

interface OllamaEmbedResponse {
  embeddings?: number[][];
  error?: string;
}

/**
 * Probe whether the Ollama host is reachable.
 * Returns false on any failure (timeout, network, non-200) so callers
 * can fall back to placeholder mode rather than throw.
 */
export async function isOllamaReachable(opts: EmbeddingClientOptions = {}): Promise<boolean> {
  const baseUrl = opts.baseUrl ?? MAC_MINI_OLLAMA_DEFAULT_URL;
  const fetchFn = opts.fetchImpl ?? fetch;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);
    const res = await fetchFn(`${baseUrl}/api/tags`, { signal: controller.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Embed a batch of texts, automatically chunking to keep per-call latency
 * predictable. Each chunk is one Ollama call.
 *
 * Ollama 0.6+ accepts `input: string[]` and returns one vector per input
 * in order. The wrapper here splits large inputs (e.g. 456 keywords)
 * into chunks of DEFAULT_EMBED_CHUNK_SIZE so no single call exceeds the
 * timeout.
 *
 * Returns vectors in the same order as inputs. Throws EmbeddingError if
 * ANY chunk fails — callers MUST decide whether to fall back to placeholder
 * mode (recommended) or fail the whole execute() call.
 */
export async function embedBatch(
  texts: string[],
  opts: EmbeddingClientOptions = {}
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const chunkSize = opts.chunkSize ?? DEFAULT_EMBED_CHUNK_SIZE;
  const out: number[][] = [];

  for (let i = 0; i < texts.length; i += chunkSize) {
    const chunk = texts.slice(i, i + chunkSize);
    const vectors = await embedOneChunk(chunk, opts);
    out.push(...vectors);
  }

  return out;
}

async function embedOneChunk(texts: string[], opts: EmbeddingClientOptions): Promise<number[][]> {
  const baseUrl = opts.baseUrl ?? MAC_MINI_OLLAMA_DEFAULT_URL;
  const model = opts.model ?? QWEN3_EMBED_MODEL;
  const fetchFn = opts.fetchImpl ?? fetch;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EMBED_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetchFn(`${baseUrl}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input: texts }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    throw new EmbeddingError(
      `Ollama embed call failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  clearTimeout(timer);

  if (!res.ok) {
    let body = '';
    try {
      body = await res.text();
    } catch {
      // ignore
    }
    throw new EmbeddingError(`Ollama embed HTTP ${res.status}: ${body.slice(0, 200)}`, res.status);
  }

  const data = (await res.json()) as OllamaEmbedResponse;
  if (data.error) {
    throw new EmbeddingError(`Ollama embed error: ${data.error}`);
  }
  if (!data.embeddings || data.embeddings.length !== texts.length) {
    throw new EmbeddingError(
      `Ollama embed returned ${data.embeddings?.length ?? 0} vectors, expected ${texts.length}`
    );
  }

  const first = data.embeddings[0];
  if (!first || first.length !== QWEN3_EMBED_DIMENSION) {
    throw new EmbeddingError(
      `Unexpected embedding dimension ${first?.length ?? 0}, expected ${QWEN3_EMBED_DIMENSION}`
    );
  }

  return data.embeddings;
}

// ============================================================================
// Cosine similarity (assumes L2-normalized inputs from Qwen3-Embedding-8B)
// ============================================================================

/**
 * Cosine similarity between two same-dimension float arrays.
 *
 * Qwen3-Embedding-8B outputs are already L2-normalized (probe verified
 * norm = 1.0000 on 2026-04-07), so this is just dot product.
 *
 * Returns a value in [-1, 1]. Map to [0, 1] for goal_relevance via
 * `(cos + 1) / 2` in the caller.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new EmbeddingError(`cosineSimilarity dimension mismatch: ${a.length} vs ${b.length}`);
  }
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
  }
  return dot;
}

/**
 * Map cosine similarity (-1, 1) to goal_relevance (0, 1).
 * Linear remap: -1 → 0, 0 → 0.5, 1 → 1.
 */
export function cosineToRelevance(cos: number): number {
  if (Number.isNaN(cos) || !Number.isFinite(cos)) return 0.5;
  const mapped = (cos + 1) / 2;
  if (mapped < 0) return 0;
  if (mapped > 1) return 1;
  return mapped;
}

// ============================================================================
// Global mandala centroid (averaged sub_goal embeddings)
// ============================================================================

/**
 * Load the global mandala centroid by averaging level=1 mandala_embeddings
 * rows. The centroid is a single 4096d vector representing "what learning
 * goals look like in the mandala universe".
 *
 * Cosine similarity with this centroid (mapped to [0, 1]) becomes the
 * keyword's `goal_relevance` axis at IKS scoring time. Per-mandala
 * goal_relevance (truly personalized) lands later in Phase 3 video-discover,
 * which reads the stored keyword_scores.embedding directly.
 *
 * Returns null if no level=1 rows have embeddings — callers should fall
 * back to the 0.5 placeholder.
 */
export async function loadGlobalCentroid(): Promise<number[] | null> {
  const db = getPrismaClient();

  // mandala_embeddings.embedding is `Unsupported("vector(4096)")` in Prisma —
  // pull it via raw query as text and parse client-side.
  const rows = await db.$queryRaw<{ embedding: string }[]>(
    Prisma.sql`SELECT embedding::text AS embedding FROM mandala_embeddings WHERE level = 1 AND embedding IS NOT NULL`
  );

  if (rows.length === 0) {
    log.warn('loadGlobalCentroid: no level=1 mandala_embeddings rows found');
    return null;
  }

  const sum = new Array<number>(QWEN3_EMBED_DIMENSION).fill(0);
  let valid = 0;
  for (const row of rows) {
    const vec = parseVectorLiteral(row.embedding);
    if (vec.length !== QWEN3_EMBED_DIMENSION) {
      continue;
    }
    for (let i = 0; i < QWEN3_EMBED_DIMENSION; i++) {
      sum[i] = (sum[i] ?? 0) + (vec[i] ?? 0);
    }
    valid += 1;
  }

  if (valid === 0) {
    log.warn('loadGlobalCentroid: all rows had wrong dimension');
    return null;
  }

  // Average + L2 normalize so cosine sim with the centroid is well-defined
  const avg = new Array<number>(QWEN3_EMBED_DIMENSION);
  let norm2 = 0;
  for (let i = 0; i < QWEN3_EMBED_DIMENSION; i++) {
    const v = (sum[i] ?? 0) / valid;
    avg[i] = v;
    norm2 += v * v;
  }
  const norm = Math.sqrt(norm2);
  if (norm === 0) return null;
  for (let i = 0; i < QWEN3_EMBED_DIMENSION; i++) {
    avg[i] = (avg[i] ?? 0) / norm;
  }

  log.info(`loadGlobalCentroid: averaged ${valid} mandala sub_goal embeddings`);
  return avg;
}

/**
 * Parse pgvector text format: "[0.1,0.2,...]" → number[]
 */
function parseVectorLiteral(literal: string): number[] {
  if (!literal || literal.length < 2) return [];
  // pgvector text format wraps in [ ]
  const inner = literal.startsWith('[') && literal.endsWith(']') ? literal.slice(1, -1) : literal;
  const parts = inner.split(',');
  const out = new Array<number>(parts.length);
  for (let i = 0; i < parts.length; i++) {
    out[i] = parseFloat(parts[i] ?? '0');
  }
  return out;
}

/**
 * Serialize a number[] to pgvector text format for $executeRaw.
 * Example: [0.1, 0.2] → "[0.1,0.2]"
 */
export function vectorToLiteral(vec: number[]): string {
  return `[${vec.join(',')}]`;
}
