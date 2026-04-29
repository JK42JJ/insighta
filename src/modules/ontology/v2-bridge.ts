/**
 * v2 Rich Summary → Ontology bridge (CP437, 2026-04-29).
 *
 * Reads a v2 layered summary (core / analysis / segments / lora) and creates:
 *   - 1 video_resource node      (per video_id)
 *   - N concept nodes            (analysis.key_concepts)
 *   - K section_node             (segments.sections)  (when segments present)
 *   - M atom_node                (segments.atoms)
 *   - P action_node              (analysis.actionables)
 *
 * Edges:
 *   video_resource → COVERS      → concept    (per key_concept)
 *   video_resource → HAS_SECTION → section_node
 *   video_resource → HAS_ATOM    → atom_node
 *   atom_node      → MENTIONS    → concept    (entity_refs match)
 *   video_resource → SUGGESTS    → action_node
 *   video_resource → RELEVANT_TO → goal       (mandala_fit.suggested_goals → existing goal nodes by exact title)
 *
 * Hard Rule (CP437 user directive 2026-04-29):
 *   - No LLM API call.
 *   - No embedding (no SIMILAR_TO).
 *   - All matching uses exact-string lookup; no fuzzy / embedding.
 *
 * Idempotent: re-running for the same videoId reuses existing nodes (looked
 * up by source_ref jsonb match) and skips duplicate edges (UNIQUE on
 * source_id+target_id+relation+user_id).
 */

import { Prisma } from '@prisma/client';

import { getPrismaClient } from '@/modules/database/client';
import { logger } from '@/utils/logger';
import { getInternalUserId } from '@/config/internal-auth';
import type { RichSummaryV2Layered, KeyConcept } from '@/modules/skills/rich-summary-v2-prompt';

const log = logger.child({ module: 'OntologyV2Bridge' });

// Optional segments shape (not in RichSummaryV2Layered type — passed through).
interface V2Section {
  idx?: number;
  title?: string;
  from_sec?: number;
  to_sec?: number;
  summary?: string;
  key_points?: unknown[];
}
interface V2Atom {
  idx?: number;
  text?: string;
  timestamp_sec?: number;
  entity_refs?: string[];
}
interface V2Segments {
  sections?: V2Section[];
  atoms?: V2Atom[];
  quotes?: unknown[];
}

export interface V2BridgeInput {
  videoId: string;
  layered: RichSummaryV2Layered;
  segments?: V2Segments | null;
}

export interface V2BridgeResult {
  videoId: string;
  videoResourceId: string;
  conceptNodeIds: string[];
  sectionNodeIds: string[];
  atomNodeIds: string[];
  actionNodeIds: string[];
  edgeCount: {
    covers: number;
    has_section: number;
    has_atom: number;
    mentions: number;
    suggests: number;
    relevant_to: number;
  };
}

/**
 * Build the full graph slice for one v2-summary upsert. Safe to re-run
 * (idempotent on the same videoId).
 */
export async function bridgeV2ToOntology(input: V2BridgeInput): Promise<V2BridgeResult> {
  const prisma = getPrismaClient();
  const userId = getInternalUserId();
  const layered = input.layered;
  const segments = input.segments ?? null;

  // 1. video_resource
  const videoResourceId = await upsertVideoResource(prisma, userId, input.videoId, layered);

  // 2. concept nodes (per analysis.key_concepts)
  const conceptIds = await Promise.all(
    layered.analysis.key_concepts.map((c) => upsertConcept(prisma, userId, c))
  );
  const conceptNameToId = new Map<string, string>(
    layered.analysis.key_concepts.map((c, i) => [c.term, conceptIds[i]!])
  );

  // 3. section_node (when segments present)
  const sectionIds: string[] = [];
  if (segments?.sections && Array.isArray(segments.sections)) {
    for (let i = 0; i < segments.sections.length; i++) {
      const s = segments.sections[i]!;
      const id = await upsertSection(prisma, userId, input.videoId, i, s);
      sectionIds.push(id);
    }
  }

  // 4. atom_node (when segments present)
  const atomIds: string[] = [];
  const atomToEntityRefs: string[][] = [];
  if (segments?.atoms && Array.isArray(segments.atoms)) {
    for (let i = 0; i < segments.atoms.length; i++) {
      const a = segments.atoms[i]!;
      const id = await upsertAtom(prisma, userId, input.videoId, i, a);
      atomIds.push(id);
      atomToEntityRefs.push(Array.isArray(a.entity_refs) ? a.entity_refs : []);
    }
  }

  // 5. action_node (per analysis.actionables)
  const actionIds: string[] = [];
  for (let i = 0; i < layered.analysis.actionables.length; i++) {
    const text = layered.analysis.actionables[i]!;
    const id = await upsertAction(prisma, userId, input.videoId, i, text);
    actionIds.push(id);
  }

  // 6. edges
  let coversCount = 0;
  for (const cid of conceptIds) {
    if (await upsertEdge(prisma, userId, videoResourceId, cid, 'COVERS')) coversCount++;
  }
  let hasSectionCount = 0;
  for (const sid of sectionIds) {
    if (await upsertEdge(prisma, userId, videoResourceId, sid, 'HAS_SECTION')) hasSectionCount++;
  }
  let hasAtomCount = 0;
  for (const aid of atomIds) {
    if (await upsertEdge(prisma, userId, videoResourceId, aid, 'HAS_ATOM')) hasAtomCount++;
  }
  let mentionsCount = 0;
  for (let i = 0; i < atomIds.length; i++) {
    const refs = atomToEntityRefs[i] ?? [];
    for (const ref of refs) {
      const target = conceptNameToId.get(ref);
      if (target && (await upsertEdge(prisma, userId, atomIds[i]!, target, 'MENTIONS'))) {
        mentionsCount++;
      }
    }
  }
  let suggestsCount = 0;
  for (const aid of actionIds) {
    if (await upsertEdge(prisma, userId, videoResourceId, aid, 'SUGGESTS')) suggestsCount++;
  }

  // RELEVANT_TO: link to existing goal nodes by exact title match (no fuzzy).
  let relevantToCount = 0;
  for (const goalTitle of layered.analysis.mandala_fit.suggested_goals ?? []) {
    const goalIds = await findGoalNodesByExactTitle(prisma, goalTitle);
    for (const gid of goalIds) {
      if (await upsertEdge(prisma, userId, videoResourceId, gid, 'RELEVANT_TO')) relevantToCount++;
    }
  }

  const result: V2BridgeResult = {
    videoId: input.videoId,
    videoResourceId,
    conceptNodeIds: conceptIds,
    sectionNodeIds: sectionIds,
    atomNodeIds: atomIds,
    actionNodeIds: actionIds,
    edgeCount: {
      covers: coversCount,
      has_section: hasSectionCount,
      has_atom: hasAtomCount,
      mentions: mentionsCount,
      suggests: suggestsCount,
      relevant_to: relevantToCount,
    },
  };
  log.info('v2-bridge done', result);
  return result;
}

// ============================================================================
// Node upserters — each looks up by source_ref pattern, inserts on miss
// ============================================================================

async function upsertVideoResource(
  prisma: ReturnType<typeof getPrismaClient>,
  userId: string,
  videoId: string,
  layered: RichSummaryV2Layered
): Promise<string> {
  const existing = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT id FROM ontology.nodes
    WHERE type = 'video_resource'
      AND source_ref->>'table' = 'youtube_videos'
      AND source_ref->>'id' = ${videoId}
    LIMIT 1
  `);
  if (existing.length > 0) return existing[0]!.id;
  const inserted = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    INSERT INTO ontology.nodes (user_id, type, title, properties, source_ref, domain)
    VALUES (
      ${userId}::uuid,
      'video_resource',
      ${layered.core.one_liner},
      ${JSON.stringify({
        domain: layered.core.domain,
        depth_level: layered.core.depth_level,
        content_type: layered.core.content_type,
      })}::jsonb,
      ${JSON.stringify({ table: 'youtube_videos', id: videoId })}::jsonb,
      'service'
    )
    RETURNING id
  `);
  return inserted[0]!.id;
}

async function upsertConcept(
  prisma: ReturnType<typeof getPrismaClient>,
  userId: string,
  concept: KeyConcept
): Promise<string> {
  const existing = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT id FROM ontology.nodes
    WHERE type = 'concept' AND title = ${concept.term}
    LIMIT 1
  `);
  if (existing.length > 0) return existing[0]!.id;
  const inserted = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    INSERT INTO ontology.nodes (user_id, type, title, properties, source_ref, domain)
    VALUES (
      ${userId}::uuid,
      'concept',
      ${concept.term},
      ${JSON.stringify({ definition: concept.definition })}::jsonb,
      ${JSON.stringify({ table: 'video_rich_summaries.key_concepts', term: concept.term })}::jsonb,
      'service'
    )
    RETURNING id
  `);
  return inserted[0]!.id;
}

async function upsertSection(
  prisma: ReturnType<typeof getPrismaClient>,
  userId: string,
  videoId: string,
  idx: number,
  section: V2Section
): Promise<string> {
  const existing = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT id FROM ontology.nodes
    WHERE type = 'section_node'
      AND source_ref->>'table' = 'video_rich_summaries.sections'
      AND source_ref->>'video_id' = ${videoId}
      AND source_ref->>'idx' = ${String(idx)}
    LIMIT 1
  `);
  if (existing.length > 0) return existing[0]!.id;
  const inserted = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    INSERT INTO ontology.nodes (user_id, type, title, properties, source_ref, domain)
    VALUES (
      ${userId}::uuid,
      'section_node',
      ${section.title ?? `Section ${idx}`},
      ${JSON.stringify({
        from_sec: section.from_sec ?? 0,
        to_sec: section.to_sec ?? 0,
        summary: section.summary ?? '',
      })}::jsonb,
      ${JSON.stringify({
        table: 'video_rich_summaries.sections',
        video_id: videoId,
        idx,
      })}::jsonb,
      'service'
    )
    RETURNING id
  `);
  return inserted[0]!.id;
}

async function upsertAtom(
  prisma: ReturnType<typeof getPrismaClient>,
  userId: string,
  videoId: string,
  idx: number,
  atom: V2Atom
): Promise<string> {
  const existing = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT id FROM ontology.nodes
    WHERE type = 'atom_node'
      AND source_ref->>'table' = 'video_rich_summaries.atoms'
      AND source_ref->>'video_id' = ${videoId}
      AND source_ref->>'idx' = ${String(idx)}
    LIMIT 1
  `);
  if (existing.length > 0) return existing[0]!.id;
  const inserted = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    INSERT INTO ontology.nodes (user_id, type, title, properties, source_ref, domain)
    VALUES (
      ${userId}::uuid,
      'atom_node',
      ${(atom.text ?? '').slice(0, 200)},
      ${JSON.stringify({
        text: atom.text ?? '',
        timestamp_sec: atom.timestamp_sec ?? null,
      })}::jsonb,
      ${JSON.stringify({
        table: 'video_rich_summaries.atoms',
        video_id: videoId,
        idx,
        anchor:
          typeof atom.timestamp_sec === 'number'
            ? { kind: 'atom', idx, timestamp_sec: atom.timestamp_sec }
            : null,
      })}::jsonb,
      'service'
    )
    RETURNING id
  `);
  return inserted[0]!.id;
}

async function upsertAction(
  prisma: ReturnType<typeof getPrismaClient>,
  userId: string,
  videoId: string,
  idx: number,
  text: string
): Promise<string> {
  const existing = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT id FROM ontology.nodes
    WHERE type = 'action_node'
      AND source_ref->>'table' = 'video_rich_summaries.actionables'
      AND source_ref->>'video_id' = ${videoId}
      AND source_ref->>'idx' = ${String(idx)}
    LIMIT 1
  `);
  if (existing.length > 0) return existing[0]!.id;
  const inserted = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    INSERT INTO ontology.nodes (user_id, type, title, properties, source_ref, domain)
    VALUES (
      ${userId}::uuid,
      'action_node',
      ${text.slice(0, 200)},
      ${JSON.stringify({ text })}::jsonb,
      ${JSON.stringify({
        table: 'video_rich_summaries.actionables',
        video_id: videoId,
        idx,
      })}::jsonb,
      'service'
    )
    RETURNING id
  `);
  return inserted[0]!.id;
}

// ============================================================================
// Edge upserter
// ============================================================================

async function upsertEdge(
  prisma: ReturnType<typeof getPrismaClient>,
  userId: string,
  sourceId: string,
  targetId: string,
  relation: string
): Promise<boolean> {
  // Check existing
  const existing = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT id FROM ontology.edges
    WHERE source_id = ${sourceId}::uuid
      AND target_id = ${targetId}::uuid
      AND relation = ${relation}
      AND user_id = ${userId}::uuid
    LIMIT 1
  `);
  if (existing.length > 0) return false;
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO ontology.edges (user_id, source_id, target_id, relation, weight, properties, domain)
    VALUES (
      ${userId}::uuid,
      ${sourceId}::uuid,
      ${targetId}::uuid,
      ${relation},
      1.0,
      '{}'::jsonb,
      'service'
    )
  `);
  return true;
}

// ============================================================================
// Goal lookup (for RELEVANT_TO edges)
// ============================================================================

async function findGoalNodesByExactTitle(
  prisma: ReturnType<typeof getPrismaClient>,
  title: string
): Promise<string[]> {
  if (!title) return [];
  const rows = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT id FROM ontology.nodes
    WHERE type IN ('goal', 'mandala', 'mandala_sector')
      AND title = ${title}
    LIMIT 50
  `);
  return rows.map((r) => r.id);
}
