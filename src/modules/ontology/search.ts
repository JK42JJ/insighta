import { getPrismaClient } from '../database/client';

// ============================================================================
// Ontology Search — pgvector cosine similarity + full-text
// ============================================================================

export interface VectorSearchResult {
  id: string;
  type: string;
  title: string;
  properties: Record<string, unknown>;
  similarity: number;
}

export interface TextSearchResult {
  id: string;
  type: string;
  title: string;
  properties: Record<string, unknown>;
  rank: number;
}

export async function searchByVector(
  userId: string,
  queryEmbedding: number[],
  options: {
    limit?: number;
    threshold?: number;
    type_filter?: string;
  } = {}
): Promise<VectorSearchResult[]> {
  const prisma = getPrismaClient();
  const limit = Math.min(options.limit ?? 10, 50);
  const threshold = options.threshold ?? 0.3;

  const embeddingStr = `[${queryEmbedding.join(',')}]`;

  if (options.type_filter) {
    return prisma.$queryRaw<VectorSearchResult[]>`
      SELECT
        n.id, n.type, n.title, n.properties,
        1 - (e.embedding <=> ${embeddingStr}::vector) AS similarity
      FROM ontology.embeddings e
      JOIN ontology.nodes n ON n.id = e.node_id
      WHERE n.user_id = ${userId}::uuid
        AND n.type = ${options.type_filter}
        AND 1 - (e.embedding <=> ${embeddingStr}::vector) >= ${threshold}
      ORDER BY e.embedding <=> ${embeddingStr}::vector
      LIMIT ${limit}
    `;
  }

  return prisma.$queryRaw<VectorSearchResult[]>`
    SELECT
      n.id, n.type, n.title, n.properties,
      1 - (e.embedding <=> ${embeddingStr}::vector) AS similarity
    FROM ontology.embeddings e
    JOIN ontology.nodes n ON n.id = e.node_id
    WHERE n.user_id = ${userId}::uuid
      AND 1 - (e.embedding <=> ${embeddingStr}::vector) >= ${threshold}
    ORDER BY e.embedding <=> ${embeddingStr}::vector
    LIMIT ${limit}
  `;
}

export async function searchByText(
  userId: string,
  query: string,
  options: {
    limit?: number;
    type_filter?: string;
  } = {}
): Promise<TextSearchResult[]> {
  const prisma = getPrismaClient();
  const limit = Math.min(options.limit ?? 20, 100);

  if (options.type_filter) {
    return prisma.$queryRaw<TextSearchResult[]>`
      SELECT
        id, type, title, properties,
        ts_rank(to_tsvector('english', title), plainto_tsquery('english', ${query})) AS rank
      FROM ontology.nodes
      WHERE user_id = ${userId}::uuid
        AND type = ${options.type_filter}
        AND to_tsvector('english', title) @@ plainto_tsquery('english', ${query})
      ORDER BY rank DESC
      LIMIT ${limit}
    `;
  }

  return prisma.$queryRaw<TextSearchResult[]>`
    SELECT
      id, type, title, properties,
      ts_rank(to_tsvector('english', title), plainto_tsquery('english', ${query})) AS rank
    FROM ontology.nodes
    WHERE user_id = ${userId}::uuid
      AND to_tsvector('english', title) @@ plainto_tsquery('english', ${query})
    ORDER BY rank DESC
    LIMIT ${limit}
  `;
}
