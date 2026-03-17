import { getPrismaClient } from '../database/client';
import * as crypto from 'crypto';
// ============================================================================
// Ontology Embedding Service — Gemini text-embedding-004 (768d)
// ADR-4: Gemini API for embeddings (free tier: 1500 req/day)
// ============================================================================

const GEMINI_MODEL = 'text-embedding-004';
const EMBEDDING_DIMENSION = 768;
const GEMINI_EMBED_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:embedContent`;

interface EmbedResult {
  embedding: { values: number[] };
}

export async function generateEmbedding(text: string): Promise<number[]> {
  const apiKey = process.env['GEMINI_API_KEY'];
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY not configured');
  }

  const response = await fetch(`${GEMINI_EMBED_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: `models/${GEMINI_MODEL}`,
      content: { parts: [{ text }] },
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Gemini API error ${response.status}: ${errorBody}`);
  }

  const data = (await response.json()) as EmbedResult;
  return data.embedding.values;
}

function textHash(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

export async function embedNode(
  nodeId: string,
  title: string,
  properties: Record<string, unknown>
): Promise<boolean> {
  const prisma = getPrismaClient();

  // Build text representation for embedding
  const textParts = [title];
  if (properties['symptom']) textParts.push(String(properties['symptom']));
  if (properties['cause']) textParts.push(String(properties['cause']));
  if (properties['solution']) textParts.push(String(properties['solution']));
  if (properties['lesson']) textParts.push(String(properties['lesson']));
  if (properties['rationale']) textParts.push(String(properties['rationale']));
  if (properties['description']) textParts.push(String(properties['description']));
  if (properties['url']) textParts.push(String(properties['url']));
  if (properties['user_note']) textParts.push(String(properties['user_note']));

  const text = textParts.filter(Boolean).join(' | ');
  const hash = textHash(text);

  // Check if already embedded with same content
  const existing = await prisma.$queryRaw<{ text_hash: string | null }[]>`
    SELECT text_hash FROM ontology.embeddings
    WHERE node_id = ${nodeId}::uuid AND model = ${GEMINI_MODEL}
  `;

  if (existing.length > 0 && existing[0]?.text_hash === hash) {
    return false; // Already embedded, no change
  }

  // Generate embedding via Gemini API
  const embedding = await generateEmbedding(text);

  if (embedding.length !== EMBEDDING_DIMENSION) {
    throw new Error(`Expected ${EMBEDDING_DIMENSION}d embedding, got ${embedding.length}d`);
  }

  const embeddingStr = `[${embedding.join(',')}]`;

  // Upsert embedding
  await prisma.$executeRaw`
    INSERT INTO ontology.embeddings (node_id, model, embedding, text_hash)
    VALUES (${nodeId}::uuid, ${GEMINI_MODEL}, ${embeddingStr}::vector, ${hash})
    ON CONFLICT (node_id, model) DO UPDATE
    SET embedding = ${embeddingStr}::vector, text_hash = ${hash}, created_at = now()
  `;

  return true; // New or updated
}

export async function batchEmbedNodes(
  userId: string,
  options: {
    limit?: number;
    typeFilter?: string;
    delayMs?: number;
  } = {}
): Promise<{ embedded: number; skipped: number; errors: number }> {
  const prisma = getPrismaClient();
  const limit = options.limit ?? 100;
  const delayMs = options.delayMs ?? 200; // Rate limiting: ~5 req/sec

  // Get nodes that need embedding (no embedding or outdated)
  let nodes: { id: string; title: string; properties: Record<string, unknown> }[];

  if (options.typeFilter) {
    nodes = await prisma.$queryRaw`
      SELECT n.id, n.title, n.properties
      FROM ontology.nodes n
      LEFT JOIN ontology.embeddings e ON e.node_id = n.id AND e.model = ${GEMINI_MODEL}
      WHERE n.user_id = ${userId}::uuid
        AND n.type = ${options.typeFilter}
      ORDER BY e.created_at ASC NULLS FIRST
      LIMIT ${limit}
    `;
  } else {
    nodes = await prisma.$queryRaw`
      SELECT n.id, n.title, n.properties
      FROM ontology.nodes n
      LEFT JOIN ontology.embeddings e ON e.node_id = n.id AND e.model = ${GEMINI_MODEL}
      WHERE n.user_id = ${userId}::uuid
      ORDER BY e.created_at ASC NULLS FIRST
      LIMIT ${limit}
    `;
  }

  let embedded = 0;
  let skipped = 0;
  let errors = 0;

  for (const node of nodes) {
    try {
      const wasEmbedded = await embedNode(
        node.id,
        node.title,
        node.properties as Record<string, unknown>
      );
      if (wasEmbedded) {
        embedded++;
      } else {
        skipped++;
      }
    } catch (err) {
      errors++;
      console.error(`Error embedding node ${node.id}: ${err}`);
    }

    // Rate limiting delay
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return { embedded, skipped, errors };
}
