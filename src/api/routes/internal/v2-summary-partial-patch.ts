/**
 * POST /api/v1/internal/v2-summary/partial-patch
 *
 * Partial backfill endpoint for pre-CP474 v2 rows that are missing the
 * `analysis.entities[]` typed-vocabulary field or the per-section
 * `segments.sections[].relevance_pct` field. Other fields are NEVER
 * touched — caller specifies only what changes.
 *
 * Auth: x-internal-token header (shared INTERNAL_BATCH_TOKEN secret).
 *
 * Body:
 *   {
 *     videoId: string,
 *     entities?: Array<{ name: string, type: 'concept'|'person'|'tool'|'framework'|'organization' }>,
 *     sectionRelevances?: Record<string, number>   // key = section idx as string, value = 0..100
 *   }
 *
 * Returns 200 { status: 'ok', data: { applied: { entities: bool, sections: bool } } }
 */

import type { FastifyPluginAsync } from 'fastify';
import { getPrismaClient } from '@/modules/database/client';
import { getInternalBatchToken } from '@/config/internal-auth';
import { logger } from '@/utils/logger';

const VALID_ENTITY_TYPES = new Set(['concept', 'person', 'tool', 'framework', 'organization']);

interface PartialPatchBody {
  videoId?: string;
  entities?: Array<{ name?: unknown; type?: unknown }>;
  sectionRelevances?: Record<string, unknown>;
  keyConcepts?: Array<{ term?: unknown; definition?: unknown }>;
}

export const v2SummaryPartialPatchRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post<{ Body: PartialPatchBody }>('/v2-summary/partial-patch', async (request, reply) => {
    const expected = getInternalBatchToken();
    if (!expected) {
      return reply.code(503).send({ error: 'internal trigger not configured' });
    }
    const got = request.headers['x-internal-token'];
    if (typeof got !== 'string' || got !== expected) {
      return reply.code(401).send({ error: 'invalid internal token' });
    }

    const videoId = String(request.body?.videoId ?? '').trim();
    if (!videoId || videoId.length > 20) {
      return reply.code(400).send({ error: 'videoId required' });
    }

    const entitiesIn = Array.isArray(request.body?.entities) ? request.body.entities : null;
    const sectionRelIn =
      request.body?.sectionRelevances && typeof request.body.sectionRelevances === 'object'
        ? request.body.sectionRelevances
        : null;
    const keyConceptsIn = Array.isArray(request.body?.keyConcepts)
      ? request.body.keyConcepts
      : null;

    if (!entitiesIn && !sectionRelIn && !keyConceptsIn) {
      return reply
        .code(400)
        .send({ error: 'entities, sectionRelevances, or keyConcepts required' });
    }

    // Validate + sanitise inputs.
    const cleanEntities = entitiesIn
      ? entitiesIn
          .map((e) => {
            const name = typeof e?.name === 'string' ? e.name.trim() : '';
            const type = typeof e?.type === 'string' ? e.type.trim() : '';
            if (!name || !VALID_ENTITY_TYPES.has(type)) return null;
            return { name, type };
          })
          .filter((e): e is { name: string; type: string } => e !== null)
      : null;

    const cleanSectionRel: Record<number, number> | null = sectionRelIn
      ? Object.entries(sectionRelIn).reduce<Record<number, number>>((acc, [k, v]) => {
          const idx = Number(k);
          const pct = typeof v === 'number' ? Math.round(v) : NaN;
          if (Number.isInteger(idx) && idx >= 0 && Number.isFinite(pct) && pct >= 0 && pct <= 100) {
            acc[idx] = pct;
          }
          return acc;
        }, {})
      : null;

    // 3-5 entries, each {term: string, definition: string}. Replaces the
    // existing key_concepts array verbatim (no merge — caller passes the
    // full set in the target language).
    const cleanKeyConcepts = keyConceptsIn
      ? keyConceptsIn
          .map((kc) => {
            const term = typeof kc?.term === 'string' ? kc.term.trim() : '';
            const definition = typeof kc?.definition === 'string' ? kc.definition.trim() : '';
            if (!term) return null;
            return { term, definition };
          })
          .filter((kc): kc is { term: string; definition: string } => kc !== null)
          .slice(0, 8)
      : null;

    const prisma = getPrismaClient();
    const row = await prisma.video_rich_summaries.findUnique({
      where: { video_id: videoId },
      select: { video_id: true, analysis: true, segments: true },
    });
    if (!row) {
      return reply.code(404).send({ error: 'v2 row not found' });
    }

    let appliedEntities = false;
    let appliedSections = false;
    let appliedKeyConcepts = false;

    // Patch analysis.entities and/or analysis.key_concepts in a single
    // analysis-column write (avoids two sequential updates that would race).
    if (
      (cleanEntities && cleanEntities.length > 0) ||
      (cleanKeyConcepts && cleanKeyConcepts.length > 0)
    ) {
      const analysis = (row.analysis ?? {}) as Record<string, unknown>;
      if (cleanEntities && cleanEntities.length > 0) {
        analysis['entities'] = cleanEntities;
        appliedEntities = true;
      }
      if (cleanKeyConcepts && cleanKeyConcepts.length > 0) {
        analysis['key_concepts'] = cleanKeyConcepts;
        appliedKeyConcepts = true;
      }
      await prisma.video_rich_summaries.update({
        where: { video_id: videoId },
        data: {
          analysis: analysis as object,
          updated_at: new Date(),
        },
      });
    }

    // Patch segments.sections[idx].relevance_pct (only on indices present in map).
    if (cleanSectionRel && Object.keys(cleanSectionRel).length > 0) {
      const segments = (row.segments ?? null) as {
        sections?: Array<Record<string, unknown>>;
      } | null;
      const sections = Array.isArray(segments?.sections) ? segments.sections : null;
      if (sections && sections.length > 0) {
        const next = sections.map((sec, idx) => {
          const pct = cleanSectionRel[idx];
          if (pct == null) return sec;
          return { ...sec, relevance_pct: pct };
        });
        await prisma.video_rich_summaries.update({
          where: { video_id: videoId },
          data: {
            segments: { ...(segments ?? {}), sections: next } as object,
            updated_at: new Date(),
          },
        });
        appliedSections = true;
      }
    }

    logger.info('v2 partial-patch applied', {
      videoId,
      appliedEntities,
      appliedSections,
      appliedKeyConcepts,
      entityCount: cleanEntities?.length ?? 0,
      sectionCount: cleanSectionRel ? Object.keys(cleanSectionRel).length : 0,
      keyConceptCount: cleanKeyConcepts?.length ?? 0,
    });

    return reply.code(200).send({
      status: 'ok',
      data: {
        applied: {
          entities: appliedEntities,
          sections: appliedSections,
          keyConcepts: appliedKeyConcepts,
        },
      },
    });
  });
};
