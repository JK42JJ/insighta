/**
 * src/modules/chatbot-rag/retriever.ts
 *
 * RAG retrieval for the chatbot — produces Block H content.
 *
 * Pipeline (MVP):
 *   1. Embed the user's query (ontology embedding provider — Gemini/Ollama)
 *   2. Cosine search against `ontology.nodes` filtered to this user
 *      (searchByVector applies `n.user_id = ${userId}` automatically)
 *   3. Cohere rerank the top-N hits to refine ranking
 *   4. Hydrate node properties (title, mandala_name, cell_name, date)
 *      into RAGResult shape
 *
 * Future extensions (out of scope MVP):
 *   - Direct text search on user_local_cards (joined with video_rich_summaries)
 *   - Direct query on note_documents
 *   - Knowledge graph neighbor expansion via getNeighbors()
 *   - Per-user retrieval cache (1-min TTL)
 *
 * Failures degrade gracefully:
 *   - Embedding throws → return empty results (chatbot answers without RAG)
 *   - Vector search throws → empty results
 *   - Cohere reranker missing/throws → fall back to raw vector ranking
 *
 * Design: docs/design/insighta-chatbot-prompt-serving-design.md §4 + CP474.
 */

import { generateEmbedding } from '@/modules/ontology/embedding';
import { searchByVector, type VectorSearchResult } from '@/modules/ontology/search';
import { rerank } from '@/modules/rerank/cohere-client';
import { logger } from '@/utils/logger';
import { type RAGResult, type RAGContext } from './types';

const log = logger.child({ module: 'chatbot-rag/retriever' });

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/** Initial top-N from vector search before rerank trims further. */
const VECTOR_TOP_N = 12;

/** Final top-K returned to the prompt builder (Block H size). */
const DEFAULT_FINAL_K = 5;

/** Lower bound on Cohere relevance_score. Below this → drop the candidate. */
const RERANK_MIN_SCORE = 0.15;

/** Lower bound on cosine similarity (handed straight to searchByVector). */
const SEARCH_SIMILARITY_THRESHOLD = 0.3;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface RetrieveRAGContextParams {
  userId: string;
  query: string;
  /** Optional: focus retrieval to a specific mandala. Currently unused (KG nodes are user-scoped). */
  mandalaId?: string;
  /** Override the default final K (Block H size). */
  topK?: number;
  /** Optional ISO timestamp to attach to the returned RAGContext (test injection). */
  now?: () => Date;
}

/**
 * Run the chatbot RAG pipeline and return the prompt-ready context.
 * Never throws — caller can always pass the result into prompt-builder.
 *
 * @returns A RAGContext with 0–topK results.
 */
export async function retrieveRAGContext(params: RetrieveRAGContextParams): Promise<RAGContext> {
  const finalK = params.topK ?? DEFAULT_FINAL_K;
  const now = (params.now ?? ((): Date => new Date()))();

  // Defensive: empty / whitespace-only query short-circuits without
  // triggering the embedding pipeline.
  const trimmedQuery = params.query.trim();
  if (trimmedQuery.length === 0) {
    return { results: [], query: '', retrieved_at: now.toISOString() };
  }

  // Stage 1+2: embed + vector search (user-scoped via searchByVector).
  let candidates: VectorSearchResult[] = [];
  try {
    const embedding = await generateEmbedding(trimmedQuery);
    candidates = await searchByVector(params.userId, embedding, {
      limit: VECTOR_TOP_N,
      threshold: SEARCH_SIMILARITY_THRESHOLD,
    });
  } catch (err) {
    log.warn('vector retrieval failed — returning empty RAG context', {
      userId: params.userId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { results: [], query: trimmedQuery, retrieved_at: now.toISOString() };
  }

  if (candidates.length === 0) {
    return { results: [], query: trimmedQuery, retrieved_at: now.toISOString() };
  }

  // Stage 3: Cohere rerank (best-effort). Failure → keep vector ranking.
  const reranked = await rerankCandidates(trimmedQuery, candidates, finalK);

  // Stage 4: hydrate RAGResult shape.
  const results: RAGResult[] = reranked.map((c) => toRAGResult(c));

  return {
    results,
    query: trimmedQuery,
    retrieved_at: now.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Cohere rerank with graceful fallback. When the reranker isn't configured
 * or returns an error, we keep the original vector ranking and trim to finalK.
 */
async function rerankCandidates(
  query: string,
  candidates: VectorSearchResult[],
  finalK: number
): Promise<VectorSearchResult[]> {
  if (candidates.length <= 1) return candidates.slice(0, finalK);

  const documents = candidates.map((c) =>
    // Concatenate the most signal-bearing fields so the cross-encoder has
    // text to score against. Keep ordering identical to `candidates`.
    [
      c.title,
      (c.properties['summary'] as string | undefined) ?? '',
      (c.properties['one_liner'] as string | undefined) ?? '',
    ]
      .filter(Boolean)
      .join('\n')
  );

  try {
    const response = await rerank({
      query,
      documents,
      topN: finalK,
    });

    return response.results
      .filter((r) => r.relevanceScore >= RERANK_MIN_SCORE)
      .map((r) => candidates[r.index])
      .filter((c): c is VectorSearchResult => c !== undefined);
  } catch (err) {
    log.warn('Cohere rerank failed — falling back to raw vector ranking', {
      error: err instanceof Error ? err.message : String(err),
      candidateCount: candidates.length,
    });
    return candidates.slice(0, finalK);
  }
}

/**
 * Map an ontology VectorSearchResult into the prompt-ready RAGResult shape.
 *
 * Ontology node `type` values seen in prod (non-exhaustive):
 *   - 'video', 'card'       → source_type 'card'
 *   - 'note', 'document'    → source_type 'note'
 *   - others (concept/etc.) → source_type 'kg_node'
 */
function toRAGResult(c: VectorSearchResult): RAGResult {
  const sourceType = classifySourceType(c.type);
  const props = c.properties ?? {};

  return {
    source_type: sourceType,
    title: c.title,
    excerpt: extractExcerpt(props),
    mandala_name: optionalString(props['mandala_name']),
    cell_name: optionalString(props['cell_name']),
    date: optionalString(props['saved_at'] ?? props['created_at']),
    similarity: c.similarity,
  };
}

function classifySourceType(nodeType: string): RAGResult['source_type'] {
  const t = nodeType.toLowerCase();
  if (t === 'video' || t === 'card' || t === 'youtube_video') return 'card';
  if (t === 'note' || t === 'document') return 'note';
  return 'kg_node';
}

function extractExcerpt(props: Record<string, unknown>): string {
  const candidates = [
    props['summary'],
    props['one_liner'],
    props['core_argument'],
    props['description'],
    props['excerpt'],
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim().length > 0) {
      return c.length > 280 ? `${c.slice(0, 277)}...` : c;
    }
  }
  return '';
}

function optionalString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) return value;
  return undefined;
}
