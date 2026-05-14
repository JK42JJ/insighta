/**
 * Cohere Rerank API Client
 *
 * Cross-encoder reranking via Cohere's `rerank-multilingual-v3.0` (or
 * configured override). Wraps POST https://api.cohere.com/v2/rerank.
 *
 * Spec: docs/design/insighta-hybrid-retrieval-2026-05-12.md
 * Origin: Issue #610 (medical-English flooding) — pattern borrowed from
 * YT-Navigator (`app/services/chunks_reranker/reranker.py`), reimplemented
 * against Cohere managed API instead of self-hosted BGE / Mac Mini TEI.
 *
 * Why Cohere over self-host:
 *   - Mac Mini = temporary scaffold (single SLA, Seoul↔us-west-2 latency).
 *   - OpenRouter has no reranker (verified 2026-05-12 catalogue scan).
 *   - Cohere = zero ops, 100-200ms latency, multilingual (Korean), cost
 *     < $10/mo at our wizard-pipeline volume.
 */

import { config } from '@/config/index';
import { logger } from '@/utils/logger';
import { recordTrace } from '@/modules/discover-tracing';

const COHERE_RERANK_URL = 'https://api.cohere.com/v2/rerank';

const log = logger.child({ module: 'cohere-rerank' });

export interface RerankInput {
  /** The user query / sub_goal text the candidates should be scored against. */
  query: string;
  /** Candidate texts (e.g. video titles, transcript segments). Index preserved. */
  documents: ReadonlyArray<string>;
  /**
   * Top-N to return. If omitted, Cohere returns all candidates scored.
   * Caller may still trim further after applying its own thresholds.
   */
  topN?: number;
  /** Model id override. Defaults to `config.cohere.rerankModel`. */
  model?: string;
  /** Optional request id for downstream correlation. */
  requestId?: string;
}

export interface RerankResult {
  /** Index back into the original `documents` array. */
  index: number;
  /** Cohere relevance_score: 0.0 – 1.0 (cross-encoder cosine, not standardized). */
  relevanceScore: number;
}

export interface RerankResponse {
  results: RerankResult[];
  /** Wall-clock latency of the upstream call, milliseconds. */
  latencyMs: number;
  /** Returned by Cohere for metering. */
  billedUnits?: { search_units?: number };
}

export class CohereRerankConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CohereRerankConfigError';
  }
}

export class CohereRerankApiError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string) {
    super(`Cohere rerank API error ${status}: ${body.slice(0, 200)}`);
    this.name = 'CohereRerankApiError';
    this.status = status;
    this.body = body;
  }
}

/**
 * Calls Cohere Rerank v2 and returns reordered indices + scores.
 *
 * Failure modes:
 *   - No API key configured → CohereRerankConfigError (caller decides fallback).
 *   - HTTP non-2xx → CohereRerankApiError (caller may skip rerank for that batch).
 *   - Network timeout → AbortError (5s default, configurable via env).
 *
 * The caller is expected to handle errors and fall back to the unreranked
 * candidate order — rerank is a quality boost, not a correctness gate.
 */
export async function rerank(input: RerankInput): Promise<RerankResponse> {
  const apiKey = config.cohere.apiKey;
  if (!apiKey) {
    throw new CohereRerankConfigError(
      'COHERE_API_KEY not configured — see memory/credentials.md to set it up'
    );
  }

  if (input.documents.length === 0) {
    return { results: [], latencyMs: 0 };
  }

  const model = input.model ?? config.cohere.rerankModel;
  const body = {
    model,
    query: input.query,
    documents: input.documents.slice(),
    ...(input.topN !== undefined && input.topN > 0 ? { top_n: input.topN } : {}),
  };

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), config.cohere.rerankTimeoutMs);

  const t0 = Date.now();
  let resp: Response;
  try {
    resp = await fetch(COHERE_RERANK_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  const latencyMs = Date.now() - t0;

  if (!resp.ok) {
    const text = await resp.text().catch(() => '<no body>');
    log.warn('cohere rerank non-2xx', {
      status: resp.status,
      latencyMs,
      requestId: input.requestId,
      bodyPreview: text.slice(0, 200),
    });
    throw new CohereRerankApiError(resp.status, text);
  }

  const json = (await resp.json()) as {
    results?: Array<{ index: number; relevance_score: number }>;
    meta?: { billed_units?: { search_units?: number } };
  };

  const results: RerankResult[] = Array.isArray(json.results)
    ? json.results.map((r) => ({
        index: r.index,
        relevanceScore: r.relevance_score,
      }))
    : [];

  log.info('cohere rerank ok', {
    requestId: input.requestId,
    n: input.documents.length,
    returned: results.length,
    latencyMs,
    billedSearchUnits: json.meta?.billed_units?.search_units,
  });

  // CP457+ trace — capture rerank input + scored output. fire-and-forget.
  recordTrace({
    step: 'hybrid_rerank.cohere',
    status: 'ok',
    request: {
      model,
      query: input.query,
      document_count: input.documents.length,
      top_n: input.topN,
      documents: input.documents.slice(),
    },
    response: { results, billedUnits: json.meta?.billed_units },
    latencyMs,
  });

  return {
    results,
    latencyMs,
    billedUnits: json.meta?.billed_units,
  };
}
