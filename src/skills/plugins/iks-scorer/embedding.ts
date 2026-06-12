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

import { createHash } from 'crypto';

import { logger } from '@/utils/logger';
import { getPrismaClient } from '@/modules/database';
import { Prisma } from '@prisma/client';
import { config } from '@/config/index';
import { logLLMCall } from '@/modules/llm/call-logger';
import { recordTrace } from '@/modules/discover-tracing';

const log = logger.child({ module: 'iks-scorer/embedding' });

export const QWEN3_EMBED_MODEL = 'qwen3-embedding:8b';
export const QWEN3_EMBED_DIMENSION = 4096;
export const MAC_MINI_OLLAMA_DEFAULT_URL = 'http://100.91.173.17:11434';
const HEALTH_CHECK_TIMEOUT_MS = 3000;
// CP489 — was 60000 (60s). Probe-verified actual call latencies:
//   warm chunk (≤50 texts): ~0.3-3s
//   cold start (Mac Mini Ollama reloads qwen3-embedding:8b 4.7GB): ~10s
//   hang case (idle unload + concurrent load): observed 54.5s (CP489 incident)
// 60s lets a hang block the entire user-facing pipeline (add-cards 60s
// FE timeout fires before Ollama AbortController). 20s gives Mac Mini
// enough headroom for cold start while triggering the OpenRouter
// fallback (embedOneChunkViaOpenRouterRetrying) within the FE budget.
// Cumulative worst case under fallback: 20s Ollama + 3× OpenRouter
// chunks × ~1-3s typical = ~30s, still inside add-cards' 60s envelope.
const EMBED_TIMEOUT_MS = 20000;

/** OpenRouter cost-logger module label (Issue #543 fallback path). */
const OPENROUTER_FALLBACK_MODULE = 'iks-embed-fallback';
/**
 * OpenRouter embed transient-error retry policy (CP458).
 * OpenRouter's /embeddings endpoint returns an intermittent HTTP 404
 * — measured ~11% (8 err / 71 calls in 12h). The 404 is transient (the
 * other 89% succeed), so 404 / 5xx / network errors are retried.
 */
const OPENROUTER_EMBED_MAX_RETRIES = 2;
const OPENROUTER_EMBED_RETRY_BASE_MS = 500;
/**
 * Embed chunk size — Mac Mini M4 handles ~50 texts in ~10s comfortably.
 * 456 texts in one call exceeds 60s timeout. Chunking gives predictable
 * per-call latency.
 */
const DEFAULT_EMBED_CHUNK_SIZE = 50;

export class EmbeddingError extends Error {
  constructor(
    message: string,
    public readonly httpStatus?: number,
    /**
     * True when the error is transient and a retry may succeed (network
     * failure, HTTP 404 — see OPENROUTER_EMBED_* note — or 5xx). False for
     * deterministic failures (auth, count/dimension mismatch).
     */
    public readonly retryable: boolean = false
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
  /** Per-call timeout override (ms). Defaults to EMBED_TIMEOUT_MS. */
  timeoutMs?: number;
  /** W3 (CP499+) — external abort (e.g. the calling pipeline gave up).
   *  Linked into the per-call controller so an abandoned pipeline doesn't
   *  leave embeds running to completion. */
  signal?: AbortSignal;
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
 * Returns one slot per input, in order. Per-chunk isolation (CP458): a
 * chunk whose embed call fails yields `null` for each of its inputs rather
 * than failing the whole batch — a single bad chunk used to throw away
 * every embedding (promote-from-playlists imported 197 rows with 0
 * embeddings because one of its 4 chunks failed). The returned array length
 * always equals `texts.length`; callers MUST null-check each entry.
 * Does not throw for chunk-level failures.
 */
export async function embedBatch(
  texts: string[],
  opts: EmbeddingClientOptions = {}
): Promise<(number[] | null)[]> {
  if (texts.length === 0) return [];
  const chunkSize = opts.chunkSize ?? DEFAULT_EMBED_CHUNK_SIZE;
  const out: (number[] | null)[] = [];
  const t0 = Date.now();
  let failedChunks = 0;

  for (let i = 0; i < texts.length; i += chunkSize) {
    const chunk = texts.slice(i, i + chunkSize);
    try {
      const vectors = await embedOneChunk(chunk, opts);
      out.push(...vectors);
    } catch (err) {
      failedChunks += 1;
      log.warn(
        `embedBatch chunk [${i}, ${i + chunk.length}) failed — continuing without it: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
      for (let j = 0; j < chunk.length; j += 1) out.push(null);
    }
  }

  const okCount = out.reduce((n, v) => (v ? n + 1 : n), 0);
  const firstVec = out.find((v): v is number[] => v != null);
  const chunkCount = Math.ceil(texts.length / chunkSize);
  // CP457+ trace — text inputs + vector counts (skip the 4096d vectors
  // themselves to keep payload sane; record first-3-dim sample per vec).
  // CP488 — embed cost rollup: chunkCount = number of provider round-trips
  // (Mac Mini Ollama or OpenRouter); embed_chunks counter is meaningful for
  // ops cost comparison across algorithm versions.
  recordTrace({
    step: 'embed.batch',
    status: okCount > 0 ? 'ok' : 'error',
    request: { text_count: texts.length, chunk_size: chunkSize, texts: texts.slice(0, 50) },
    response: {
      vector_count: okCount,
      failed_chunks: failedChunks,
      dim: firstVec?.length ?? 0,
      samples: out
        .filter((v): v is number[] => v != null)
        .slice(0, 3)
        .map((v) => v.slice(0, 3)),
    },
    latencyMs: Date.now() - t0,
    costUnits: { embed_calls: chunkCount, embed_chunks: chunkCount - failedChunks },
  });
  return out;
}

/**
 * Issue #543 — provider-routed embed entry.
 *
 *   IKS_EMBED_PROVIDER=openrouter  → skip Mac-mini, go straight to OpenRouter
 *   IKS_EMBED_PROVIDER=ollama      → try Mac-mini, on fetch/HTTP error fall
 *                                    back to OpenRouter (same OPENROUTER_*
 *                                    config as embedGoalForMandala)
 *
 * The fallback path keeps this codebase's auto-add chain alive when the
 * Mac-mini host is unreachable (CP436 prod incident: pipeline-runner
 * step1 ensureMandalaEmbeddings threw → step2/3 skipped → 0 cards in
 * dashboard while recommendation_cache had 74 rows).
 */
/**
 * CP500+ PR2 (#882/#899 family) — single-flight over identical chunks.
 *
 * Identical concurrent chunks (e.g. racing pipeline runs re-embedding the
 * same centerGoal+titles — CP499 measured the wizard multiple-fire 2-4×/goal)
 * share ONE provider round-trip. The 2026-06-09/10 `iks-embed-fallback` tail
 * (p95 12-14.7s, max 102.8-114.3s) is the same stall class the goal-embed
 * single-flight in mandala/search.ts already removes — this extends the cover
 * to the batch path. Failures are NOT cached (`finally` evicts).
 *
 * Signal semantics: the SHARED call runs WITHOUT any caller's external signal
 * (internal per-attempt timeouts still bound it — W3); each signal-bearing
 * caller instead races the shared promise against its own abort, so one
 * caller's abort rejects ONLY that caller and never kills a joiner's result.
 */
const inflightChunks = new Map<string, Promise<number[][]>>();

async function embedOneChunk(texts: string[], opts: EmbeddingClientOptions): Promise<number[][]> {
  // Key = full route (provider + host + model), not just texts — the same
  // texts against a different host/model must NOT share a result.
  const key = createHash('sha1')
    .update(`${config.iksEmbed.provider}|${opts.baseUrl ?? ''}|${opts.model ?? ''}|`)
    .update(texts.join('\u001f'))
    .digest('hex');
  let shared = inflightChunks.get(key);
  if (!shared) {
    shared = embedOneChunkRouted(texts, { ...opts, signal: undefined }).finally(() => {
      inflightChunks.delete(key);
    });
    inflightChunks.set(key, shared);
  }
  if (!opts.signal) return shared;
  return raceExternalAbort(shared, opts.signal);
}

function raceExternalAbort(shared: Promise<number[][]>, signal: AbortSignal): Promise<number[][]> {
  if (signal.aborted) return Promise.reject(new Error('embed cancelled by external signal'));
  return new Promise<number[][]>((resolve, reject) => {
    const onAbort = () => reject(new Error('embed cancelled by external signal'));
    signal.addEventListener('abort', onAbort, { once: true });
    shared.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener('abort', onAbort);
        reject(e);
      }
    );
  });
}

async function embedOneChunkRouted(
  texts: string[],
  opts: EmbeddingClientOptions
): Promise<number[][]> {
  const provider = config.iksEmbed.provider;
  if (provider === 'openrouter') {
    // OpenRouter primary (retry on transient errors) → Ollama fallback once
    // retries are exhausted. Both produce 4096-d qwen3-embedding-8b vectors
    // so a fallback chunk stays co-comparable with the rest of the batch.
    try {
      return await embedOneChunkViaOpenRouterRetrying(texts, opts);
    } catch (err) {
      // W3 — the pipeline gave up: do NOT fall back to the other provider.
      if (opts.signal?.aborted) throw err;
      const reason = err instanceof Error ? err.message : String(err);
      log.warn(
        `OpenRouter embed failed after retries (chunk size=${texts.length}), falling back to Ollama: ${reason}`
      );
      return embedOneChunkViaOllama(texts, opts);
    }
  }
  // 'ollama' (default): Mac-mini first, OpenRouter (retrying) fallback on
  // transport/HTTP error.
  try {
    return await embedOneChunkViaOllama(texts, opts);
  } catch (err) {
    // W3 — the pipeline gave up: do NOT fall back to the other provider.
    if (opts.signal?.aborted) throw err;
    const reason = err instanceof Error ? err.message : String(err);
    log.warn(
      `Ollama embed failed (chunk size=${texts.length}), falling back to OpenRouter: ${reason}`
    );
    return embedOneChunkViaOpenRouterRetrying(texts, opts);
  }
}

async function embedOneChunkViaOllama(
  texts: string[],
  opts: EmbeddingClientOptions
): Promise<number[][]> {
  const baseUrl = opts.baseUrl ?? MAC_MINI_OLLAMA_DEFAULT_URL;
  const model = opts.model ?? QWEN3_EMBED_MODEL;
  const fetchFn = opts.fetchImpl ?? fetch;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? EMBED_TIMEOUT_MS);
  // W3 — external pipeline abort propagates into this call. An ALREADY
  // aborted signal must abort immediately (listeners never fire post-abort
  // — without this, the Ollama→OpenRouter fallback of an abandoned pipeline
  // runs its full timeout).
  const onExternalAbort = () => controller.abort();
  if (opts.signal?.aborted) controller.abort();
  else opts.signal?.addEventListener('abort', onExternalAbort, { once: true });

  // W3 (#882 mirror) — the timer must cover the BODY read too: clearing it
  // after headers left res.text()/res.json() untimed, the exact zombie
  // window measured at 86s/102.8s on the goal-embed path before #882.
  let data: OllamaEmbedResponse;
  try {
    let res: Response;
    try {
      res = await fetchFn(`${baseUrl}/api/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, input: texts }),
        signal: controller.signal,
      });
    } catch (err) {
      throw new EmbeddingError(
        `Ollama embed call failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    if (!res.ok) {
      let body = '';
      try {
        body = await res.text();
      } catch {
        // ignore
      }
      throw new EmbeddingError(
        `Ollama embed HTTP ${res.status}: ${body.slice(0, 200)}`,
        res.status
      );
    }

    data = (await res.json()) as OllamaEmbedResponse;
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onExternalAbort);
  }
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

/**
 * OpenRouter embed (OpenAI-compatible /embeddings). Used either as primary
 * (provider='openrouter') or as fallback when Ollama is unreachable.
 *
 * Reuses the same `OPENROUTER_EMBED_*` config that powers
 * `embedGoalForMandala`'s `embedViaOpenRouter` path — same model
 * (`qwen/qwen3-embedding-8b`, 4096d) so vectors stay co-comparable with
 * existing `mandala_embeddings` rows produced by Mac-mini Ollama.
 *
 * Each call is fire-and-forget logged to `llm_call_logs` (cost tracking
 * lands as input_tokens=null when token counts aren't returned by the
 * provider — pricing fallback handles that).
 */
async function embedOneChunkViaOpenRouter(
  texts: string[],
  opts: EmbeddingClientOptions
): Promise<number[][]> {
  const apiKey = config.openrouter.apiKey;
  if (!apiKey) {
    throw new EmbeddingError('OPENROUTER_API_KEY not configured (cannot fall back from Ollama)');
  }

  // NOTE: `opts.baseUrl` / `opts.model` are the *Ollama* overrides (see
  // EmbeddingClientOptions JSDoc — they default to MAC_MINI_OLLAMA_DEFAULT_URL
  // / QWEN3_EMBED_MODEL). They MUST NOT leak into the OpenRouter call. CP458:
  // promote-from-* passed `{ baseUrl: ollamaUrl }`, which made this function
  // POST to `http://<mac-mini>:11434/embeddings` — a route Ollama doesn't have
  // — yielding a deterministic "HTTP 404 page not found" on every call.
  const baseUrl = config.mandalaEmbed.openRouterBaseUrl;
  const model = config.mandalaEmbed.openRouterModel;
  const expectedDim = config.mandalaEmbed.openRouterDimension;
  const fetchFn = opts.fetchImpl ?? fetch;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? EMBED_TIMEOUT_MS);
  // W3 — external pipeline abort (pre-aborted handled; see Ollama twin).
  const onExternalAbort = () => controller.abort();
  if (opts.signal?.aborted) controller.abort();
  else opts.signal?.addEventListener('abort', onExternalAbort, { once: true });
  const t0 = Date.now();

  // W3 (#882 mirror) — timer covers the BODY read (json/text), not just
  // headers; see embedOneChunkViaOllama for the measured zombie rationale.
  try {
    let res: Response;
    try {
      res = await fetchFn(`${baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model, input: texts }),
        signal: controller.signal,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      void logLLMCall({
        module: OPENROUTER_FALLBACK_MODULE,
        model: `openrouter/${model}`,
        latencyMs: Date.now() - t0,
        status: 'error',
        errorMessage: reason,
      });
      // Network / timeout / abort — transient, safe to retry.
      throw new EmbeddingError(`OpenRouter embed call failed: ${reason}`, undefined, true);
    }

    if (!res.ok) {
      let body = '';
      try {
        body = await res.text();
      } catch {
        // ignore
      }
      const errMsg = `OpenRouter embed HTTP ${res.status}: ${body.slice(0, 200)}`;
      void logLLMCall({
        module: OPENROUTER_FALLBACK_MODULE,
        model: `openrouter/${model}`,
        latencyMs: Date.now() - t0,
        status: 'error',
        errorMessage: errMsg,
      });
      // 404 is intermittent on OpenRouter /embeddings (~11%, CP458); 5xx is
      // standard-transient. Both are retryable. 4xx-other (auth/bad request)
      // is deterministic — not retryable.
      const retryable = res.status === 404 || res.status >= 500;
      throw new EmbeddingError(errMsg, res.status, retryable);
    }

    const data = (await res.json()) as {
      data?: Array<{ embedding?: number[] }>;
      usage?: { prompt_tokens?: number; total_tokens?: number };
      error?: { message?: string };
    };
    if (data.error) {
      throw new EmbeddingError(`OpenRouter embed error: ${data.error.message ?? 'unknown'}`);
    }

    const items = data.data ?? [];
    if (items.length !== texts.length) {
      throw new EmbeddingError(
        `OpenRouter embed returned ${items.length} vectors, expected ${texts.length}`
      );
    }

    const vectors: number[][] = [];
    for (const item of items) {
      const vec = item.embedding;
      if (!vec || vec.length !== expectedDim) {
        throw new EmbeddingError(
          `OpenRouter embedding dimension mismatch: got ${vec?.length ?? 0}, expected ${expectedDim}`
        );
      }
      vectors.push(vec);
    }

    void logLLMCall({
      module: OPENROUTER_FALLBACK_MODULE,
      model: `openrouter/${model}`,
      inputTokens: data.usage?.prompt_tokens,
      latencyMs: Date.now() - t0,
      status: 'success',
    });

    return vectors;
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onExternalAbort);
  }
}

/** Promise-based sleep for retry backoff. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * `embedOneChunkViaOpenRouter` with bounded retry on transient errors.
 *
 * OpenRouter's /embeddings endpoint returns an intermittent HTTP 404
 * ("404 page not found") — measured ~11% (8 err / 71 calls, 12h, CP458).
 * It is transient, not endpoint-absent (the other 89% succeed), so
 * `EmbeddingError.retryable` is set for 404 / 5xx / network errors and we
 * retry up to OPENROUTER_EMBED_MAX_RETRIES with exponential backoff.
 * Non-retryable errors (auth, count / dimension mismatch) throw at once.
 *
 * Rationale: a single un-retried 404 on any chunk used to fail the entire
 * `embedBatch` — promote-from-playlists imported 197 rows with 0 embeddings
 * because one of its 4 chunks hit the 404.
 */
async function embedOneChunkViaOpenRouterRetrying(
  texts: string[],
  opts: EmbeddingClientOptions
): Promise<number[][]> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= OPENROUTER_EMBED_MAX_RETRIES; attempt++) {
    try {
      return await embedOneChunkViaOpenRouter(texts, opts);
    } catch (err) {
      lastErr = err;
      // W3 — external abort is terminal: the pipeline gave up, never retry.
      const retryable = err instanceof EmbeddingError && err.retryable && !opts.signal?.aborted;
      if (!retryable || attempt === OPENROUTER_EMBED_MAX_RETRIES) {
        throw err;
      }
      const backoffMs = OPENROUTER_EMBED_RETRY_BASE_MS * 2 ** attempt;
      log.warn(
        `OpenRouter embed transient error (attempt ${attempt + 1}/${
          OPENROUTER_EMBED_MAX_RETRIES + 1
        }), retrying in ${backoffMs}ms: ${err instanceof Error ? err.message : String(err)}`
      );
      await sleep(backoffMs);
    }
  }
  // Unreachable: the loop above either returns or throws. Satisfies TS.
  throw lastErr;
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
