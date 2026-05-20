/**
 * tests/unit/modules/chatbot-rag/retriever.test.ts
 *
 * Unit tests for the chatbot RAG retriever (CP474 Phase E).
 *
 * Coverage:
 *   - Empty/whitespace query → short-circuit, no embedding call
 *   - Embedding throws → empty results (graceful)
 *   - searchByVector returns 0 → empty results
 *   - Happy path: candidates returned with hydrated RAGResult shape
 *   - Cohere rerank trims to topK
 *   - Cohere rerank throws → fallback to raw vector ranking (no result loss)
 *   - Below RERANK_MIN_SCORE filtered out
 *   - source_type classification: video/card/note/concept variants
 *   - extractExcerpt prefers summary > one_liner > description
 *   - extractExcerpt truncates excerpts > 280 chars
 *
 * Mocks: ontology.embedding + ontology.search + rerank/cohere-client + logger.
 */

const mockGenerateEmbedding = jest.fn();
const mockSearchByVector = jest.fn();
const mockRerank = jest.fn();

jest.mock('@/utils/logger', () => {
  type Logger = {
    info: jest.Mock;
    warn: jest.Mock;
    error: jest.Mock;
    debug: jest.Mock;
    child: () => Logger;
  };
  const childLogger: Logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: () => childLogger,
  };
  return { logger: childLogger };
});

jest.mock('@/modules/ontology/embedding', () => ({
  generateEmbedding: mockGenerateEmbedding,
}));

jest.mock('@/modules/ontology/search', () => ({
  searchByVector: mockSearchByVector,
}));

jest.mock('@/modules/rerank/cohere-client', () => ({
  rerank: mockRerank,
}));

import { retrieveRAGContext } from '@/modules/chatbot-rag/retriever';

const FIXED_NOW = new Date('2026-05-20T00:00:00.000Z');
const FIXED_NOW_FN = () => FIXED_NOW;

function makeCandidate(overrides: {
  id?: string;
  type?: string;
  title?: string;
  similarity?: number;
  properties?: Record<string, unknown>;
}) {
  return {
    id: overrides.id ?? 'n-1',
    type: overrides.type ?? 'video',
    title: overrides.title ?? '하프 마라톤 1:30',
    properties: overrides.properties ?? { summary: '인터벌 + LSD 균형' },
    similarity: overrides.similarity ?? 0.85,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  // Default: embedding succeeds, search returns 3 candidates, rerank returns same order.
  mockGenerateEmbedding.mockResolvedValue([0.1, 0.2, 0.3]);
  mockSearchByVector.mockResolvedValue([
    makeCandidate({ id: 'n-1', similarity: 0.9, title: '인터벌' }),
    makeCandidate({ id: 'n-2', similarity: 0.8, title: 'LSD' }),
    makeCandidate({ id: 'n-3', similarity: 0.7, title: '테이퍼링' }),
  ]);
  mockRerank.mockResolvedValue({
    results: [
      { index: 0, relevanceScore: 0.95 },
      { index: 1, relevanceScore: 0.85 },
      { index: 2, relevanceScore: 0.65 },
    ],
  });
});

describe('retrieveRAGContext — short-circuit', () => {
  it('returns empty results immediately for empty query', async () => {
    const ctx = await retrieveRAGContext({ userId: 'u-1', query: '', now: FIXED_NOW_FN });
    expect(ctx.results).toEqual([]);
    expect(mockGenerateEmbedding).not.toHaveBeenCalled();
  });

  it('returns empty results for whitespace-only query', async () => {
    const ctx = await retrieveRAGContext({ userId: 'u-1', query: '   \t\n', now: FIXED_NOW_FN });
    expect(ctx.results).toEqual([]);
    expect(mockGenerateEmbedding).not.toHaveBeenCalled();
  });
});

describe('retrieveRAGContext — graceful degradation', () => {
  it('returns empty results when embedding throws', async () => {
    mockGenerateEmbedding.mockRejectedValueOnce(new Error('provider down'));

    const ctx = await retrieveRAGContext({ userId: 'u-1', query: '마라톤', now: FIXED_NOW_FN });

    expect(ctx.results).toEqual([]);
    expect(mockSearchByVector).not.toHaveBeenCalled();
  });

  it('returns empty results when searchByVector throws', async () => {
    mockSearchByVector.mockRejectedValueOnce(new Error('db unreachable'));

    const ctx = await retrieveRAGContext({ userId: 'u-1', query: '마라톤', now: FIXED_NOW_FN });

    expect(ctx.results).toEqual([]);
  });

  it('returns empty when vector search yields zero candidates', async () => {
    mockSearchByVector.mockResolvedValueOnce([]);

    const ctx = await retrieveRAGContext({ userId: 'u-1', query: '마라톤', now: FIXED_NOW_FN });

    expect(ctx.results).toEqual([]);
    expect(mockRerank).not.toHaveBeenCalled();
  });

  it('falls back to raw vector ranking when Cohere rerank throws', async () => {
    mockRerank.mockRejectedValueOnce(new Error('cohere 503'));

    const ctx = await retrieveRAGContext({ userId: 'u-1', query: '마라톤', now: FIXED_NOW_FN });

    expect(ctx.results.length).toBe(3);
    expect(ctx.results[0]!.title).toBe('인터벌');
  });
});

describe('retrieveRAGContext — happy path', () => {
  it('returns reranked candidates with hydrated RAGResult shape', async () => {
    const ctx = await retrieveRAGContext({
      userId: 'u-1',
      query: '인터벌 훈련법?',
      now: FIXED_NOW_FN,
    });

    expect(ctx).toMatchObject({
      query: '인터벌 훈련법?',
      retrieved_at: '2026-05-20T00:00:00.000Z',
    });
    expect(ctx.results.length).toBe(3);
    expect(ctx.results[0]).toMatchObject({
      source_type: 'card',
      title: '인터벌',
      excerpt: '인터벌 + LSD 균형',
    });
  });

  it('filters out candidates below RERANK_MIN_SCORE', async () => {
    mockRerank.mockResolvedValueOnce({
      results: [
        { index: 0, relevanceScore: 0.95 },
        { index: 1, relevanceScore: 0.1 }, // below 0.15 threshold
        { index: 2, relevanceScore: 0.2 },
      ],
    });

    const ctx = await retrieveRAGContext({ userId: 'u-1', query: '마라톤', now: FIXED_NOW_FN });

    expect(ctx.results.length).toBe(2);
    expect(ctx.results.map((r) => r.title)).toEqual(['인터벌', '테이퍼링']);
  });

  it('passes topK as topN to Cohere rerank', async () => {
    await retrieveRAGContext({
      userId: 'u-1',
      query: '마라톤',
      topK: 2,
      now: FIXED_NOW_FN,
    });

    expect(mockRerank).toHaveBeenCalledWith(expect.objectContaining({ topN: 2, query: '마라톤' }));
  });
});

describe('retrieveRAGContext — source_type classification', () => {
  it('classifies type=video as "card"', async () => {
    mockSearchByVector.mockResolvedValueOnce([makeCandidate({ type: 'video', title: 'X' })]);
    mockRerank.mockResolvedValueOnce({ results: [{ index: 0, relevanceScore: 0.9 }] });

    const ctx = await retrieveRAGContext({ userId: 'u-1', query: 'q', now: FIXED_NOW_FN });
    expect(ctx.results[0]!.source_type).toBe('card');
  });

  it('classifies type=note as "note"', async () => {
    mockSearchByVector.mockResolvedValueOnce([makeCandidate({ type: 'note', title: 'Y' })]);
    mockRerank.mockResolvedValueOnce({ results: [{ index: 0, relevanceScore: 0.9 }] });

    const ctx = await retrieveRAGContext({ userId: 'u-1', query: 'q', now: FIXED_NOW_FN });
    expect(ctx.results[0]!.source_type).toBe('note');
  });

  it('classifies arbitrary type as "kg_node"', async () => {
    mockSearchByVector.mockResolvedValueOnce([makeCandidate({ type: 'concept', title: 'Z' })]);
    mockRerank.mockResolvedValueOnce({ results: [{ index: 0, relevanceScore: 0.9 }] });

    const ctx = await retrieveRAGContext({ userId: 'u-1', query: 'q', now: FIXED_NOW_FN });
    expect(ctx.results[0]!.source_type).toBe('kg_node');
  });
});

describe('retrieveRAGContext — excerpt extraction', () => {
  it('prefers summary over one_liner', async () => {
    mockSearchByVector.mockResolvedValueOnce([
      makeCandidate({
        title: 'X',
        properties: { summary: 'SUMMARY', one_liner: 'ONELINER' },
      }),
    ]);
    mockRerank.mockResolvedValueOnce({ results: [{ index: 0, relevanceScore: 0.9 }] });

    const ctx = await retrieveRAGContext({ userId: 'u-1', query: 'q', now: FIXED_NOW_FN });
    expect(ctx.results[0]!.excerpt).toBe('SUMMARY');
  });

  it('truncates excerpts beyond 280 chars', async () => {
    const longText = 'A'.repeat(300);
    mockSearchByVector.mockResolvedValueOnce([
      makeCandidate({ title: 'X', properties: { summary: longText } }),
    ]);
    mockRerank.mockResolvedValueOnce({ results: [{ index: 0, relevanceScore: 0.9 }] });

    const ctx = await retrieveRAGContext({ userId: 'u-1', query: 'q', now: FIXED_NOW_FN });
    expect(ctx.results[0]!.excerpt.length).toBe(280);
    expect(ctx.results[0]!.excerpt.endsWith('...')).toBe(true);
  });

  it('returns empty excerpt when no textual properties present', async () => {
    mockSearchByVector.mockResolvedValueOnce([
      makeCandidate({ title: 'X', properties: { unrelated: 123 } }),
    ]);
    mockRerank.mockResolvedValueOnce({ results: [{ index: 0, relevanceScore: 0.9 }] });

    const ctx = await retrieveRAGContext({ userId: 'u-1', query: 'q', now: FIXED_NOW_FN });
    expect(ctx.results[0]!.excerpt).toBe('');
  });
});
