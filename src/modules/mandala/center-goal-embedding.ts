/**
 * CP489 — center_goal embedding cache helper.
 *
 * Background: every add-cards call + v3 executor Tier 1/Tier 2
 * semantic-gate invocation previously re-embedded the same mandala
 * centerGoal via Mac Mini Ollama (~0.3s warm, ~10s cold). That cold
 * start dominated CP489 timeout incident (54s embed.batch hang →
 * 60s panel timeout). Now: first call lazily writes mandala_embeddings
 * level=0 row; subsequent calls hit the DB cache (~5ms).
 *
 * Cache schema: mandala_embeddings(mandala_id, level=0, sub_goal_index=NULL,
 * text=centerGoal, embedding=4096d). Partial unique index on (mandala_id)
 * WHERE level=0 enables race-safe ON CONFLICT (one row per mandala).
 * Existing level=1 rows (8 sub_goals per mandala) untouched.
 *
 * Staleness: cached row.text compared against current centerGoal; mismatch
 * triggers re-embed + UPSERT (mirror ensureMandalaEmbeddings level=1 pattern).
 *
 * Failure model: cache write is fire-and-forget — never blocks caller.
 * Returns null only when both Ollama and OpenRouter fallback fail.
 *
 * Cross-ref:
 *   - prisma/migrations/center-goal-cache/001_partial_unique_level0.sql
 *   - src/modules/mandala/ensure-mandala-embeddings.ts (sibling, level=1)
 *   - Call sites: src/api/routes/add-cards.ts, v3/executor.ts (Tier 1 + Tier 2)
 */

import { Prisma } from '@prisma/client';
import { getPrismaClient } from '@/modules/database';
import { logger } from '@/utils/logger';
import {
  embedBatch,
  vectorToLiteral,
  QWEN3_EMBED_DIMENSION,
} from '@/skills/plugins/iks-scorer/embedding';

const log = logger.child({ module: 'center-goal-embedding' });

/**
 * Get the 4096-d center_goal embedding for a mandala. Cache-backed.
 *
 * Hit (~5ms): SELECT mandala_embeddings WHERE level=0 AND text matches.
 * Miss (~0.3s warm, ~10s cold): embedBatch → fire-and-forget UPSERT.
 *
 * Returns null when the embed provider chain (Ollama → OpenRouter) fails
 * or when mandalaId / centerGoal is empty.
 */
export async function getCenterGoalEmbedding(
  mandalaId: string,
  centerGoal: string
): Promise<number[] | null> {
  const trimmed = centerGoal.trim();
  if (!mandalaId || !trimmed) return null;
  const db = getPrismaClient();

  // 1. Cache lookup — level=0 row with matching text (staleness check)
  try {
    const rows = await db.$queryRaw<{ embedding: string; text: string | null }[]>(
      Prisma.sql`SELECT embedding::text AS embedding, text
                   FROM public.mandala_embeddings
                  WHERE mandala_id = ${mandalaId}
                    AND level = 0
                    AND embedding IS NOT NULL
                  LIMIT 1`
    );
    const hit = rows[0];
    if (hit && hit.text === trimmed) {
      const vec = parseVectorLiteral(hit.embedding);
      if (vec.length === QWEN3_EMBED_DIMENSION) return vec;
    }
    // Text drift or wrong dim → fall through to re-embed + UPSERT.
  } catch (err) {
    log.warn(
      `center-goal cache lookup failed (non-fatal, will re-embed): ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }

  // 2. Cache miss → embed via provider chain (Ollama → OpenRouter fallback).
  const [vec] = await embedBatch([trimmed]);
  if (!vec || vec.length !== QWEN3_EMBED_DIMENSION) return null;

  // 3. Fire-and-forget UPSERT — race-safe via partial unique index.
  //    Failure logged but never thrown; embedding returned to caller.
  const lit = vectorToLiteral(vec);
  void (async () => {
    try {
      await db.$executeRaw(Prisma.sql`
        INSERT INTO public.mandala_embeddings
               (mandala_id, level, sub_goal_index, text, embedding, center_goal, created_at)
        VALUES (${mandalaId}, 0, NULL, ${trimmed},
                ${lit}::vector(4096), ${trimmed}, NOW())
        ON CONFLICT (mandala_id) WHERE level = 0
        DO UPDATE SET
          text = EXCLUDED.text,
          embedding = EXCLUDED.embedding,
          center_goal = EXCLUDED.center_goal
      `);
    } catch (err) {
      log.warn(
        `center-goal cache write failed (non-fatal): ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  })();

  return vec;
}

/** Parse pgvector text literal "[v1,v2,...]" → number[]. */
function parseVectorLiteral(literal: string): number[] {
  if (!literal || literal.length < 2) return [];
  const inner = literal.startsWith('[') && literal.endsWith(']') ? literal.slice(1, -1) : literal;
  const parts = inner.split(',');
  const out = new Array<number>(parts.length);
  for (let i = 0; i < parts.length; i++) {
    out[i] = parseFloat(parts[i] ?? '0');
  }
  return out;
}
