import { Prisma } from '@prisma/client';
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
    domain?: string;
  } = {}
): Promise<VectorSearchResult[]> {
  const prisma = getPrismaClient();
  const limit = Math.min(options.limit ?? 10, 50);
  const threshold = options.threshold ?? 0.3;

  const embeddingStr = `[${queryEmbedding.join(',')}]`;

  const conditions: Prisma.Sql[] = [
    Prisma.sql`n.user_id = ${userId}::uuid`,
    Prisma.sql`1 - (e.embedding <=> ${embeddingStr}::vector) >= ${threshold}`,
  ];

  let joinClause = Prisma.sql`JOIN ontology.nodes n ON n.id = e.node_id`;

  if (options.type_filter) {
    conditions.push(Prisma.sql`n.type = ${options.type_filter}`);
  }
  if (options.domain) {
    joinClause = Prisma.sql`JOIN ontology.nodes n ON n.id = e.node_id JOIN ontology.object_types ot ON n.type = ot.code`;
    conditions.push(Prisma.sql`ot.domain = ${options.domain}`);
  }

  const where = Prisma.join(conditions, ' AND ');

  return prisma.$queryRaw<VectorSearchResult[]>`
    SELECT
      n.id, n.type, n.title, n.properties,
      1 - (e.embedding <=> ${embeddingStr}::vector) AS similarity
    FROM ontology.embeddings e
    ${joinClause}
    WHERE ${where}
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
    domain?: string;
  } = {}
): Promise<TextSearchResult[]> {
  const prisma = getPrismaClient();
  const limit = Math.min(options.limit ?? 20, 100);

  const conditions: Prisma.Sql[] = [
    Prisma.sql`n.user_id = ${userId}::uuid`,
    Prisma.sql`to_tsvector('english', n.title) @@ plainto_tsquery('english', ${query})`,
  ];

  let fromClause = Prisma.sql`ontology.nodes n`;

  if (options.type_filter) {
    conditions.push(Prisma.sql`n.type = ${options.type_filter}`);
  }
  if (options.domain) {
    fromClause = Prisma.sql`ontology.nodes n JOIN ontology.object_types ot ON n.type = ot.code`;
    conditions.push(Prisma.sql`ot.domain = ${options.domain}`);
  }

  const where = Prisma.join(conditions, ' AND ');

  return prisma.$queryRaw<TextSearchResult[]>`
    SELECT
      n.id, n.type, n.title, n.properties,
      ts_rank(to_tsvector('english', n.title), plainto_tsquery('english', ${query})) AS rank
    FROM ${fromClause}
    WHERE ${where}
    ORDER BY rank DESC
    LIMIT ${limit}
  `;
}
