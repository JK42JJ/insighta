/**
 * sync-edges.ts — Lever A (CP416)
 *
 * Replaces the per-row `trg_goal_edge` + `trg_topic_edges` triggers dropped
 * by migration `011_drop_edge_triggers.sql`. The triggers were each doing
 * 4+ sub-queries inside the wizard save transaction, totalling ~210 queries
 * and ~7s wall clock for a 9-level mandala. Moving edge creation to the
 * application layer and running it fire-and-forget after the transaction
 * commits brings `tx_levels_createMany` from ~7s to <1s while preserving
 * the same derived-data contract:
 *
 *   - One `sector CONTAINS goal` edge per non-empty `center_goal`
 *   - One `sector CONTAINS topic` edge per non-empty `subjects[]` entry
 *   - Idempotent via `ON CONFLICT (source_id, target_id, relation) DO NOTHING`
 *     on `ontology.edges` (matches the trigger's own ON CONFLICT)
 *
 * The corresponding `source_ref` JSONB lookups mirror the trigger functions
 * exactly (see `prisma/migrations/ontology/010_goal_topic_edge_triggers.sql`
 * for the reference shape):
 *
 *   goal node:   {"table": "user_mandala_levels_goal",  "id": "<level-id>"}
 *   topic node:  {"table": "user_mandala_levels_topic", "id": "<level-id>:<subject>"}
 *   sector node: {"table": "user_mandala_levels",       "id": "<level-id>"}
 *
 * Reader contract — edges are **eventually consistent** (single-digit-ms
 * lag from save commit). No path reads them inside the wizard/dashboard
 * flow; only Graph-RAG / offline analytics features consume them. See
 * `docs/design/ontology-trigger-defer.md` §1 and §4 for the audit.
 */

import { Prisma } from '@prisma/client';

import { getPrismaClient } from '@/modules/database';
import { logger } from '@/utils/logger';

const log = logger.child({ module: 'ontology/sync-edges' });

export interface SyncOntologyEdgesResult {
  ok: boolean;
  goalEdgesCreated: number;
  topicEdgesCreated: number;
  durationMs: number;
  reason?: string;
}

interface LevelRow {
  id: string;
  center_goal: string | null;
  subjects: string[] | null;
}

/**
 * Rebuild sector→goal and sector→topic CONTAINS edges for a mandala.
 *
 * Safe to call multiple times on the same mandala — all inserts use
 * `ON CONFLICT DO NOTHING` against the edges unique index. Never throws.
 */
export async function syncOntologyEdges(mandalaId: string): Promise<SyncOntologyEdgesResult> {
  const t0 = Date.now();
  const db = getPrismaClient();

  try {
    // One query: mandala user_id + all depth>=1 levels.
    // Depth 0 (root) has no "sector" node of its own — only depth>=1
    // levels are sectors. This matches the trigger semantics (the
    // triggers fired on every level, but ontology.nodes only has sector
    // rows for depth>=1 per the 008 shadow triggers — lookups for depth=0
    // returned nothing and the edges simply weren't created).
    //
    // We still fetch depth=0 to surface the mandala row lookup
    // (user_id) in one round-trip; filter to depth>=1 in JS.
    const mandala = await db.user_mandalas.findUnique({
      where: { id: mandalaId },
      select: {
        user_id: true,
        levels: {
          where: { depth: { gte: 1 } },
          select: { id: true, center_goal: true, subjects: true },
        },
      },
    });

    if (!mandala) {
      return {
        ok: false,
        goalEdgesCreated: 0,
        topicEdgesCreated: 0,
        durationMs: Date.now() - t0,
        reason: 'mandala not found',
      };
    }

    const userId = mandala.user_id;
    const levels = (mandala.levels ?? []) as LevelRow[];

    if (levels.length === 0) {
      return { ok: true, goalEdgesCreated: 0, topicEdgesCreated: 0, durationMs: Date.now() - t0 };
    }

    const levelIds = levels.map((l) => l.id);

    // One query for all sector nodes (source_ref table = user_mandala_levels).
    // pgx jsonb index `(source_ref jsonb_path_ops)` makes this fast.
    const sectorRows = await db.$queryRaw<{ id: string; level_id: string }[]>(Prisma.sql`
      SELECT id,
             source_ref->>'id' AS level_id
        FROM ontology.nodes
       WHERE source_ref->>'table' = 'user_mandala_levels'
         AND source_ref->>'id' = ANY(${levelIds})
    `);
    const sectorByLevelId = new Map<string, string>();
    for (const r of sectorRows) sectorByLevelId.set(r.level_id, r.id);

    // One query for all goal nodes.
    const goalRows = await db.$queryRaw<{ id: string; level_id: string }[]>(Prisma.sql`
      SELECT id,
             source_ref->>'id' AS level_id
        FROM ontology.nodes
       WHERE source_ref->>'table' = 'user_mandala_levels_goal'
         AND source_ref->>'id' = ANY(${levelIds})
    `);
    const goalByLevelId = new Map<string, string>();
    for (const r of goalRows) goalByLevelId.set(r.level_id, r.id);

    // Build the set of topic keys `"<level-id>:<subject>"` we need, so
    // the topic lookup is also a single query.
    const topicKeys: string[] = [];
    const topicKeyToLevelId = new Map<string, string>();
    const topicKeyToSubject = new Map<string, string>();
    for (const level of levels) {
      for (const subject of level.subjects ?? []) {
        if (!subject) continue;
        const key = `${level.id}:${subject}`;
        topicKeys.push(key);
        topicKeyToLevelId.set(key, level.id);
        topicKeyToSubject.set(key, subject);
      }
    }

    let topicByKey = new Map<string, string>();
    if (topicKeys.length > 0) {
      const topicRows = await db.$queryRaw<{ id: string; topic_key: string }[]>(Prisma.sql`
        SELECT id,
               source_ref->>'id' AS topic_key
          FROM ontology.nodes
         WHERE source_ref->>'table' = 'user_mandala_levels_topic'
           AND source_ref->>'id' = ANY(${topicKeys})
      `);
      topicByKey = new Map<string, string>();
      for (const r of topicRows) topicByKey.set(r.topic_key, r.id);
    }

    // Assemble goal-edge tuples.
    const goalEdgeTuples: Array<{ source: string; target: string }> = [];
    for (const level of levels) {
      const centerGoal = (level.center_goal ?? '').trim();
      if (!centerGoal) continue;
      const sectorId = sectorByLevelId.get(level.id);
      const goalId = goalByLevelId.get(level.id);
      if (!sectorId || !goalId) continue;
      goalEdgeTuples.push({ source: sectorId, target: goalId });
    }

    // Assemble topic-edge tuples.
    const topicEdgeTuples: Array<{ source: string; target: string }> = [];
    for (const level of levels) {
      const sectorId = sectorByLevelId.get(level.id);
      if (!sectorId) continue;
      for (const subject of level.subjects ?? []) {
        if (!subject) continue;
        const key = `${level.id}:${subject}`;
        const topicId = topicByKey.get(key);
        if (!topicId) continue;
        topicEdgeTuples.push({ source: sectorId, target: topicId });
      }
    }

    // Multi-row INSERT in one round-trip each. `unnest(source[], target[])`
    // keeps the statement size bounded regardless of tuple count.
    let goalEdgesCreated = 0;
    if (goalEdgeTuples.length > 0) {
      const sources = goalEdgeTuples.map((t) => t.source);
      const targets = goalEdgeTuples.map((t) => t.target);
      const result = await db.$executeRaw<number>(Prisma.sql`
        INSERT INTO ontology.edges (user_id, source_id, target_id, relation)
        SELECT ${userId}::uuid, s::uuid, t::uuid, 'CONTAINS'
          FROM unnest(${sources}::text[], ${targets}::text[]) AS u(s, t)
        ON CONFLICT (source_id, target_id, relation) DO NOTHING
      `);
      goalEdgesCreated = typeof result === 'number' ? result : 0;
    }

    let topicEdgesCreated = 0;
    if (topicEdgeTuples.length > 0) {
      const sources = topicEdgeTuples.map((t) => t.source);
      const targets = topicEdgeTuples.map((t) => t.target);
      const result = await db.$executeRaw<number>(Prisma.sql`
        INSERT INTO ontology.edges (user_id, source_id, target_id, relation)
        SELECT ${userId}::uuid, s::uuid, t::uuid, 'CONTAINS'
          FROM unnest(${sources}::text[], ${targets}::text[]) AS u(s, t)
        ON CONFLICT (source_id, target_id, relation) DO NOTHING
      `);
      topicEdgesCreated = typeof result === 'number' ? result : 0;
    }

    const durationMs = Date.now() - t0;
    log.info(
      `sync-edges for mandala=${mandalaId}: goal=${goalEdgesCreated}/${goalEdgeTuples.length} ` +
        `topic=${topicEdgesCreated}/${topicEdgeTuples.length} ms=${durationMs}`
    );

    return {
      ok: true,
      goalEdgesCreated,
      topicEdgesCreated,
      durationMs,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn(`sync-edges failed for mandala=${mandalaId}: ${msg}`);
    return {
      ok: false,
      goalEdgesCreated: 0,
      topicEdgesCreated: 0,
      durationMs: Date.now() - t0,
      reason: msg,
    };
  }
}
