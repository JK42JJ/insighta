/**
 * ensureMandalaEmbeddings — Phase 3.5+ helper
 *
 * Idempotently ensure a user mandala has level=1 sub_goal embeddings in
 * `mandala_embeddings`. Calls Mac Mini Ollama qwen3-embedding:8b to
 * generate 4096d vectors for the 8 subjects and INSERTs them.
 *
 * Why this exists separately from the mandala generation pipeline:
 *   The wizard's mandala creation endpoints (`/create`, `/create-with-data`,
 *   `/create-from-template`) currently persist the mandala tree into
 *   `user_mandala_levels` but do NOT populate `mandala_embeddings`. That
 *   gap caused Phase 3.5's video-discover trigger to silently skip every
 *   new user mandala with "no level=1 sub_goal embeddings yet". This
 *   module fills the gap in a fire-and-forget background task that runs
 *   AFTER the wizard response has already gone out.
 *
 * Wall time: ~8-15s per mandala against Mac Mini (qwen3-embedding:8b,
 * 4096d, 8 sub_goals in one batch). Callers MUST invoke via fire-and-forget
 * — NEVER block user-facing requests.
 *
 * Idempotency: if 8 embeddings already exist, returns true immediately
 * without calling Ollama. If a partial state exists (say, 3/8 from a
 * previous crash), the partials are DELETEd and regenerated cleanly.
 */

import { Prisma } from '@prisma/client';
import { getPrismaClient } from '@/modules/database';
import { logger } from '@/utils/logger';
import { embedBatch, vectorToLiteral } from '@/skills/plugins/iks-scorer/embedding';

const log = logger.child({ module: 'ensure-mandala-embeddings' });

const EXPECTED_SUB_GOAL_COUNT = 8;

export interface EnsureEmbeddingsResult {
  ok: boolean;
  /** True if embeddings were already present (no Ollama call). */
  alreadyPresent: boolean;
  /** Number of embedding rows at the end of the call. */
  finalCount: number;
  /** Wall time of the Ollama call, 0 if skipped. */
  embedMs: number;
  /** Reason string when ok=false. */
  reason?: string;
}

/**
 * Ensure embeddings exist. Returns a structured result so callers can
 * distinguish "already there" (no work) from "just generated" (Ollama
 * was called) from "cannot generate" (bad mandala state or Ollama down).
 */
export async function ensureMandalaEmbeddings(mandalaId: string): Promise<EnsureEmbeddingsResult> {
  const db = getPrismaClient();

  // ── Step 1: current state ─────────────────────────────────────────
  const existing = await db.$queryRaw<{ count: bigint }[]>(
    Prisma.sql`SELECT count(*)::bigint AS count
               FROM mandala_embeddings
               WHERE mandala_id = ${mandalaId} AND level = 1 AND embedding IS NOT NULL`
  );
  const currentCount = Number(existing[0]?.count ?? 0);
  if (currentCount >= EXPECTED_SUB_GOAL_COUNT) {
    log.info(
      `embeddings already present for mandala=${mandalaId} (${currentCount}/${EXPECTED_SUB_GOAL_COUNT})`
    );
    return {
      ok: true,
      alreadyPresent: true,
      finalCount: currentCount,
      embedMs: 0,
    };
  }

  // ── Step 2: load root level + subjects ────────────────────────────
  const rootRows = await db.$queryRaw<{ center_goal: string; subjects: string[] }[]>(
    Prisma.sql`SELECT center_goal, subjects
               FROM user_mandala_levels
               WHERE mandala_id = ${mandalaId} AND depth = 0
               LIMIT 1`
  );
  if (rootRows.length === 0) {
    return {
      ok: false,
      alreadyPresent: false,
      finalCount: currentCount,
      embedMs: 0,
      reason: `mandala ${mandalaId} has no root (depth=0) level`,
    };
  }
  const root = rootRows[0]!;
  const subjects = (root.subjects ?? []).filter(
    (s): s is string => typeof s === 'string' && s.trim().length > 0
  );
  if (subjects.length < EXPECTED_SUB_GOAL_COUNT) {
    return {
      ok: false,
      alreadyPresent: false,
      finalCount: currentCount,
      embedMs: 0,
      reason: `mandala ${mandalaId} root has ${subjects.length}/${EXPECTED_SUB_GOAL_COUNT} non-empty subjects`,
    };
  }

  // ── Step 3: clean partial state (if any) ──────────────────────────
  if (currentCount > 0) {
    await db.$executeRaw(
      Prisma.sql`DELETE FROM mandala_embeddings WHERE mandala_id = ${mandalaId} AND level = 1`
    );
    log.info(`cleaned ${currentCount} partial embeddings for mandala=${mandalaId}`);
  }

  // ── Step 4: generate via Mac Mini Ollama ──────────────────────────
  const eightSubjects = subjects.slice(0, EXPECTED_SUB_GOAL_COUNT);
  const t0 = Date.now();
  let vectors: number[][];
  try {
    vectors = await embedBatch(eightSubjects);
  } catch (err) {
    return {
      ok: false,
      alreadyPresent: false,
      finalCount: currentCount,
      embedMs: Date.now() - t0,
      reason: `embedBatch failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const embedMs = Date.now() - t0;

  if (vectors.length !== EXPECTED_SUB_GOAL_COUNT) {
    return {
      ok: false,
      alreadyPresent: false,
      finalCount: currentCount,
      embedMs,
      reason: `embedBatch returned ${vectors.length}/${EXPECTED_SUB_GOAL_COUNT} vectors`,
    };
  }

  // ── Step 5: INSERT rows via $executeRaw (pgvector Unsupported column) ─
  let inserted = 0;
  for (let i = 0; i < EXPECTED_SUB_GOAL_COUNT; i++) {
    const subject = eightSubjects[i] ?? '';
    const vec = vectors[i];
    if (!vec) continue;
    const literal = vectorToLiteral(vec);
    try {
      await db.$executeRaw(
        Prisma.sql`INSERT INTO mandala_embeddings
                    (mandala_id, level, sub_goal_index, sub_goal, embedding, language, center_goal)
                   VALUES
                    (${mandalaId}, 1, ${i}, ${subject}, ${literal}::vector, 'ko', ${root.center_goal})`
      );
      inserted += 1;
    } catch (err) {
      log.warn(
        `embedding INSERT failed for mandala=${mandalaId} sub_goal_index=${i}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  const ok = inserted === EXPECTED_SUB_GOAL_COUNT;
  log.info(
    `embeddings generated for mandala=${mandalaId}: ${inserted}/${EXPECTED_SUB_GOAL_COUNT} in ${embedMs}ms ok=${ok}`
  );
  return {
    ok,
    alreadyPresent: false,
    finalCount: inserted,
    embedMs,
    ...(ok ? {} : { reason: `inserted ${inserted}/${EXPECTED_SUB_GOAL_COUNT} rows` }),
  };
}
