/**
 * KG Bridge — Rich Summary → ontology edges (MENTIONS + SIMILAR_TO)
 *
 * No new node creation. Only creates edges between existing resource node
 * and existing topic/goal nodes.
 * - MENTIONS: FTS text match from summary content → existing nodes
 * - SIMILAR_TO: embedding cosine similarity > threshold → existing nodes
 *
 * Issue: #504, #505
 */

import { getPrismaClient } from '@/modules/database/client';
import { embedNode } from './embedding';
import { logger } from '@/utils/logger';
import type { RichSummaryV2 } from '@/modules/skills/rich-summary-types';
import { Prisma } from '@prisma/client';
import { config } from '@/config/index';

const log = logger.child({ module: 'KGBridge' });

// ============================================================================
// Types
// ============================================================================

export interface KGBridgeResult {
  videoId: string;
  mentionEdgesCreated: number;
  similarEdgesCreated: number;
  embeddingGenerated: boolean;
}

interface ResourceNode {
  id: string;
  user_id: string;
}

// ============================================================================
// Main bridge function
// ============================================================================

export async function bridgeRichSummaryToKG(
  videoId: string,
  userId: string,
  structured: RichSummaryV2
): Promise<KGBridgeResult> {
  const prisma = getPrismaClient();

  const result: KGBridgeResult = {
    videoId,
    mentionEdgesCreated: 0,
    similarEdgesCreated: 0,
    embeddingGenerated: false,
  };

  const resourceNode = await findResourceNode(prisma, videoId, userId);
  if (!resourceNode) {
    log.warn('No resource node found for video — skipping KG bridge', { videoId, userId });
    return result;
  }

  const mentionTexts = extractMentionTexts(structured);
  if (mentionTexts.length > 0) {
    result.mentionEdgesCreated = await createMentionEdges(
      prisma,
      userId,
      resourceNode.id,
      mentionTexts
    );
  }

  const { edgesCreated, embeddingGenerated } = await createSimilarEdges(
    prisma,
    userId,
    resourceNode,
    config.kgBridge.similarToThreshold
  );
  result.similarEdgesCreated = edgesCreated;
  result.embeddingGenerated = embeddingGenerated;

  log.info('KG Bridge completed', result);
  return result;
}

// ============================================================================
// Resource node lookup (supports both card tables)
// ============================================================================

async function findResourceNode(
  prisma: ReturnType<typeof getPrismaClient>,
  videoId: string,
  userId: string
): Promise<ResourceNode | null> {
  const rows = await prisma.$queryRaw<ResourceNode[]>`
    SELECT id, user_id FROM ontology.nodes
    WHERE user_id = ${userId}::uuid
      AND type = 'resource'
      AND (
        (source_ref->>'table' = 'user_local_cards'
         AND EXISTS (
           SELECT 1 FROM user_local_cards c
           WHERE c.id::text = source_ref->>'id'
             AND c.video_id = ${videoId}
         ))
        OR
        (source_ref->>'table' = 'user_video_states'
         AND EXISTS (
           SELECT 1 FROM user_video_states uvs
           JOIN youtube_videos yv ON yv.id = uvs.video_id
           WHERE uvs.id::text = source_ref->>'id'
             AND yv.video_id = ${videoId}
         ))
      )
    LIMIT 1
  `;
  return rows[0] ?? null;
}

// ============================================================================
// MENTIONS: FTS text match from summary content → existing nodes
// ============================================================================

function extractMentionTexts(structured: RichSummaryV2): string[] {
  const texts: string[] = [];

  for (const section of structured.sections ?? []) {
    for (const kp of section.key_points ?? []) {
      if (kp.text?.trim()) texts.push(kp.text.trim());
    }
  }

  for (const prereq of structured.prerequisites ?? []) {
    if (prereq?.trim()) texts.push(prereq.trim());
  }

  for (const topic of structured.mandala_fit?.suggested_topics ?? []) {
    if (topic?.trim()) texts.push(topic.trim());
  }

  return texts;
}

async function createMentionEdges(
  prisma: ReturnType<typeof getPrismaClient>,
  userId: string,
  resourceNodeId: string,
  mentionTexts: string[]
): Promise<number> {
  const matchedNodeIds = new Set<string>();

  for (const text of mentionTexts) {
    const matches = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM ontology.nodes
      WHERE user_id = ${userId}::uuid
        AND type IN ('topic', 'goal')
        AND id != ${resourceNodeId}::uuid
        AND to_tsvector('simple', title) @@ plainto_tsquery('simple', ${text})
      LIMIT 5
    `;
    for (const m of matches) {
      matchedNodeIds.add(m.id);
    }
  }

  if (matchedNodeIds.size === 0) return 0;

  const edges = Array.from(matchedNodeIds).map((targetId) => ({
    source_id: resourceNodeId,
    target_id: targetId,
    relation: 'MENTIONS',
  }));

  return bulkCreateEdges(prisma, userId, edges);
}

// ============================================================================
// SIMILAR_TO: embedding cosine similarity
// ============================================================================

async function createSimilarEdges(
  prisma: ReturnType<typeof getPrismaClient>,
  userId: string,
  resourceNode: ResourceNode,
  threshold: number
): Promise<{ edgesCreated: number; embeddingGenerated: boolean }> {
  const nodeData = await prisma.$queryRaw<
    Array<{ title: string; properties: Record<string, unknown> }>
  >`
    SELECT title, properties FROM ontology.nodes
    WHERE id = ${resourceNode.id}::uuid LIMIT 1
  `;
  if (!nodeData[0]) return { edgesCreated: 0, embeddingGenerated: false };

  let embeddingGenerated = false;
  try {
    const wasNew = await embedNode(resourceNode.id, nodeData[0].title, nodeData[0].properties);
    embeddingGenerated = wasNew;
  } catch (err) {
    log.error('Failed to generate resource node embedding for SIMILAR_TO', {
      nodeId: resourceNode.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return { edgesCreated: 0, embeddingGenerated: false };
  }

  const similar = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT n.id
    FROM ontology.nodes n
    JOIN ontology.embeddings e ON e.node_id = n.id
    JOIN ontology.embeddings re ON re.node_id = ${resourceNode.id}::uuid
      AND re.model = e.model
    WHERE n.user_id = ${userId}::uuid
      AND n.id != ${resourceNode.id}::uuid
      AND n.type IN ('topic', 'goal', 'resource')
      AND 1 - (e.embedding <=> re.embedding) > ${threshold}
    ORDER BY e.embedding <=> re.embedding ASC
    LIMIT 10
  `;

  if (similar.length === 0) return { edgesCreated: 0, embeddingGenerated };

  const edges = similar.map((s) => ({
    source_id: resourceNode.id,
    target_id: s.id,
    relation: 'SIMILAR_TO',
  }));

  const edgesCreated = await bulkCreateEdges(prisma, userId, edges);
  return { edgesCreated, embeddingGenerated };
}

// ============================================================================
// Shared: bulk edge INSERT
// ============================================================================

async function bulkCreateEdges(
  prisma: ReturnType<typeof getPrismaClient>,
  userId: string,
  edges: Array<{ source_id: string; target_id: string; relation: string }>
): Promise<number> {
  if (edges.length === 0) return 0;

  const valueFragments = edges.map(
    (e) =>
      Prisma.sql`(${userId}::uuid, ${e.source_id}::uuid, ${e.target_id}::uuid, ${e.relation}, 1.0, '{}'::jsonb)`
  );

  try {
    const inserted = await prisma.$executeRaw`
      INSERT INTO ontology.edges (user_id, source_id, target_id, relation, weight, properties)
      VALUES ${Prisma.join(valueFragments)}
      ON CONFLICT ON CONSTRAINT unique_edge DO NOTHING
    `;
    return inserted;
  } catch (err) {
    log.error('Bulk edge insert failed', {
      count: edges.length,
      relations: [...new Set(edges.map((e) => e.relation))],
      error: err instanceof Error ? err.message : String(err),
    });
    return 0;
  }
}
