/**
 * KG Bridge — Rich Summary → ontology nodes/edges auto-conversion
 *
 * Converts v2 rich summary data into Knowledge Graph structure:
 * - entities[] → topic nodes (UPSERT by title within user scope)
 * - atoms[] → insight nodes (always new per video)
 * - core_argument → insight node
 * - Edges: TAGGED_WITH, DERIVED_FROM, REFERENCES
 *
 * Issue: #504, #505
 * Design: docs/design/insighta-kg-structure-audit-and-bridge-handoff.md §4
 */

import { getPrismaClient } from '@/modules/database/client';
import { getOntologyManager } from './manager';
import { embedNode } from './embedding';
import { logger } from '@/utils/logger';
import type { RichSummaryV2 } from '@/modules/skills/rich-summary-types';
import { Prisma } from '@prisma/client';

const log = logger.child({ module: 'KGBridge' });

// ============================================================================
// Types
// ============================================================================

export interface KGBridgeResult {
  videoId: string;
  topicNodesCreated: number;
  topicNodesReused: number;
  insightNodesCreated: number;
  edgesCreated: number;
  embeddingsQueued: number;
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
  const manager = getOntologyManager();

  const result: KGBridgeResult = {
    videoId,
    topicNodesCreated: 0,
    topicNodesReused: 0,
    insightNodesCreated: 0,
    edgesCreated: 0,
    embeddingsQueued: 0,
  };

  const resourceNode = await findResourceNode(prisma, videoId, userId);
  if (!resourceNode) {
    log.warn('No resource node found for video — skipping KG bridge', { videoId, userId });
    return result;
  }

  // 1. Process entities → topic nodes (UPSERT)
  const topicNodeIds = new Map<string, string>();
  for (const entity of structured.entities ?? []) {
    const normalizedName = entity.name.trim().toLowerCase();
    if (!normalizedName) continue;

    const existingTopic = await findTopicByTitle(prisma, userId, normalizedName);
    if (existingTopic) {
      topicNodeIds.set(normalizedName, existingTopic.id);
      result.topicNodesReused++;
    } else {
      try {
        const node = await manager.createNode(userId, {
          type: 'topic',
          title: entity.name.trim(),
          properties: { description: entity.type },
        });
        topicNodeIds.set(normalizedName, node.id);
        result.topicNodesCreated++;
        queueEmbedding(node.id, node.title, node.properties);
        result.embeddingsQueued++;
      } catch (err) {
        log.warn('Failed to create topic node', {
          entity: entity.name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  // 2. Collect edges for bulk INSERT
  const pendingEdges: Array<{ source_id: string; target_id: string; relation: string }> = [];

  // TAGGED_WITH edges (resource → topic)
  for (const [, topicId] of topicNodeIds) {
    pendingEdges.push({
      source_id: resourceNode.id,
      target_id: topicId,
      relation: 'TAGGED_WITH',
    });
  }

  // 3. Process atoms + core_argument → insight nodes
  const insightTexts: Array<{ text: string; entityRefs: string[]; sourceField: string }> = [];

  if (structured.core_argument) {
    insightTexts.push({
      text: structured.core_argument,
      entityRefs: [],
      sourceField: 'core_argument',
    });
  }

  for (let i = 0; i < (structured.atoms?.length ?? 0); i++) {
    const atom = structured.atoms[i];
    if (!atom) continue;
    insightTexts.push({
      text: atom.text,
      entityRefs: atom.entity_refs ?? [],
      sourceField: `atoms[${i}]`,
    });
  }

  for (const insight of insightTexts) {
    const sourceRef = {
      table: 'public.video_rich_summaries',
      id: videoId,
      field: insight.sourceField,
    };

    const existing = await findInsightBySourceRef(prisma, userId, sourceRef);
    if (existing) continue;

    try {
      const node = await manager.createNode(userId, {
        type: 'insight',
        title: insight.text.slice(0, 200),
        properties: { confidence: 0.7 },
        source_ref: { table: sourceRef.table, id: `${sourceRef.id}:${sourceRef.field}` },
      });
      result.insightNodesCreated++;
      queueEmbedding(node.id, node.title, node.properties);
      result.embeddingsQueued++;

      // DERIVED_FROM edge (resource → insight)
      pendingEdges.push({
        source_id: resourceNode.id,
        target_id: node.id,
        relation: 'DERIVED_FROM',
      });

      // REFERENCES edges (insight → topic) for matching entity_refs
      for (const ref of insight.entityRefs) {
        const normalizedRef = ref.trim().toLowerCase();
        const topicId = topicNodeIds.get(normalizedRef);
        if (topicId) {
          pendingEdges.push({
            source_id: node.id,
            target_id: topicId,
            relation: 'REFERENCES',
          });
        }
      }
    } catch (err) {
      log.warn('Failed to create insight node', {
        field: insight.sourceField,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 4. Bulk INSERT all edges (single query, skip duplicates)
  if (pendingEdges.length > 0) {
    result.edgesCreated = await bulkCreateEdges(prisma, userId, pendingEdges);
  }

  log.info('KG Bridge completed', result);
  return result;
}

// ============================================================================
// Helpers
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
      AND source_ref->>'table' = 'user_local_cards'
      AND EXISTS (
        SELECT 1 FROM user_local_cards c
        WHERE c.id::text = source_ref->>'id'
          AND c.youtube_video_id = ${videoId}
      )
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function findTopicByTitle(
  prisma: ReturnType<typeof getPrismaClient>,
  userId: string,
  normalizedTitle: string
): Promise<{ id: string } | null> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM ontology.nodes
    WHERE user_id = ${userId}::uuid
      AND type = 'topic'
      AND lower(trim(title)) = ${normalizedTitle}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function findInsightBySourceRef(
  prisma: ReturnType<typeof getPrismaClient>,
  userId: string,
  sourceRef: { table: string; id: string; field: string }
): Promise<{ id: string } | null> {
  const compositeId = `${sourceRef.id}:${sourceRef.field}`;
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM ontology.nodes
    WHERE user_id = ${userId}::uuid
      AND type = 'insight'
      AND source_ref->>'table' = ${sourceRef.table}
      AND source_ref->>'id' = ${compositeId}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

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
    log.warn('Bulk edge insert failed', {
      count: edges.length,
      error: err instanceof Error ? err.message : String(err),
    });
    return 0;
  }
}

function queueEmbedding(nodeId: string, title: string, properties: Record<string, unknown>): void {
  setImmediate(() => {
    embedNode(nodeId, title, properties).catch((err: unknown) => {
      log.warn('Embedding generation failed (non-fatal)', {
        nodeId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  });
}
