import { getPrismaClient } from '../database/client';
import * as crypto from 'crypto';
import { createEmbeddingProvider } from '../llm';
import type { EmbeddingProvider } from '../llm';
// ============================================================================
// Ontology Embedding Service — Provider-based (Gemini or Ollama)
// ADR-4: Gemini API for embeddings (free tier)
// #251: LLM Provider Abstraction (auto/gemini/ollama via LLM_PROVIDER)
// ============================================================================

let embeddingProvider: EmbeddingProvider | null = null;

async function getProvider(): Promise<EmbeddingProvider> {
  if (!embeddingProvider) {
    embeddingProvider = await createEmbeddingProvider();
  }
  return embeddingProvider;
}

export async function generateEmbedding(text: string): Promise<number[]> {
  const provider = await getProvider();
  return provider.embed(text);
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
  // Extracts meaningful text from both system (problem/pattern) and service (resource/topic/goal) nodes
  const textParts = [title];
  const TEXT_KEYS = [
    // system domain
    'symptom',
    'cause',
    'solution',
    'lesson',
    'rationale',
    'description',
    // service domain
    'url',
    'user_note',
    'level_key',
    'summary',
  ] as const;
  for (const key of TEXT_KEYS) {
    if (properties[key]) textParts.push(String(properties[key]));
  }
  // service: subjects array (mandala sector topics)
  if (Array.isArray(properties['subjects'])) {
    textParts.push((properties['subjects'] as string[]).join(', '));
  }
  // service: summary_tags array (AI-extracted keywords)
  if (Array.isArray(properties['summary_tags'])) {
    textParts.push((properties['summary_tags'] as string[]).join(', '));
  }

  const text = textParts.filter(Boolean).join(' | ');
  const hash = textHash(text);

  const provider = await getProvider();
  const modelName = provider.name;

  // Check if already embedded with same content
  const existing = await prisma.$queryRaw<{ text_hash: string | null }[]>`
    SELECT text_hash FROM ontology.embeddings
    WHERE node_id = ${nodeId}::uuid AND model = ${modelName}
  `;

  if (existing.length > 0 && existing[0]?.text_hash === hash) {
    return false; // Already embedded, no change
  }

  // Generate embedding via provider
  const embedding = await generateEmbedding(text);

  if (embedding.length !== provider.dimension) {
    throw new Error(`Expected ${provider.dimension}d embedding, got ${embedding.length}d`);
  }

  const embeddingStr = `[${embedding.join(',')}]`;

  // Upsert embedding
  await prisma.$executeRaw`
    INSERT INTO ontology.embeddings (node_id, model, embedding, text_hash)
    VALUES (${nodeId}::uuid, ${modelName}, ${embeddingStr}::vector, ${hash})
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

  const provider = await getProvider();
  const modelName = provider.name;

  // Get nodes that need embedding (no embedding or outdated)
  let nodes: { id: string; title: string; properties: Record<string, unknown> }[];

  if (options.typeFilter) {
    nodes = await prisma.$queryRaw`
      SELECT n.id, n.title, n.properties
      FROM ontology.nodes n
      LEFT JOIN ontology.embeddings e ON e.node_id = n.id AND e.model = ${modelName}
      WHERE n.user_id = ${userId}::uuid
        AND n.type = ${options.typeFilter}
      ORDER BY e.created_at ASC NULLS FIRST
      LIMIT ${limit}
    `;
  } else {
    nodes = await prisma.$queryRaw`
      SELECT n.id, n.title, n.properties
      FROM ontology.nodes n
      LEFT JOIN ontology.embeddings e ON e.node_id = n.id AND e.model = ${modelName}
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
      const wasEmbedded = await embedNode(node.id, node.title, node.properties);
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
