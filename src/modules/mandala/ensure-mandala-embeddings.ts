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
 *
 * Targeted fill strategy (not blanket regenerate):
 *   - Load per-index state (sub_goal_index, sub_goal text, embedding presence)
 *   - Classify each index as OK / missing / stale (text drifted from current subject)
 *   - Only delete + regenerate the OUT-OF-SYNC indexes
 *   - Leave OK rows untouched so concurrent readers + previously-valid
 *     embeddings are preserved
 *
 * This avoids the destructive "if partial then nuke all" pattern: if 5 of 8
 * rows are legitimately present (e.g. from an earlier successful run that
 * was interrupted, or from a different code path that wrote partials), we
 * must NOT wipe them. Fill the missing 3 only.
 *
 * Staleness detection: the stored sub_goal text is compared against the
 * current root subjects[i]. If they differ, the mandala was edited after
 * embedding generation — regenerate just that index with the new text.
 */
export async function ensureMandalaEmbeddings(mandalaId: string): Promise<EnsureEmbeddingsResult> {
  const db = getPrismaClient();

  // ── Step 1: load root level + subjects ────────────────────────────
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
      finalCount: 0,
      embedMs: 0,
      reason: `mandala ${mandalaId} has no root (depth=0) level`,
    };
  }
  const root = rootRows[0]!;
  const allSubjects = (root.subjects ?? []).filter(
    (s): s is string => typeof s === 'string' && s.trim().length > 0
  );
  if (allSubjects.length < EXPECTED_SUB_GOAL_COUNT) {
    return {
      ok: false,
      alreadyPresent: false,
      finalCount: 0,
      embedMs: 0,
      reason: `mandala ${mandalaId} root has ${allSubjects.length}/${EXPECTED_SUB_GOAL_COUNT} non-empty subjects`,
    };
  }
  const currentSubjects = allSubjects.slice(0, EXPECTED_SUB_GOAL_COUNT);

  // ── Step 2: load existing per-index state ─────────────────────────
  // One row per (mandala, sub_goal_index). We read both the text and
  // whether the embedding is populated so we can tell stale from missing.
  const existingRows = await db.$queryRaw<
    { sub_goal_index: number | null; sub_goal: string | null; has_embedding: boolean }[]
  >(
    Prisma.sql`SELECT sub_goal_index, sub_goal, (embedding IS NOT NULL) AS has_embedding
               FROM mandala_embeddings
               WHERE mandala_id = ${mandalaId} AND level = 1`
  );

  // Group by sub_goal_index. If duplicates exist (data inconsistency),
  // prefer the one with a valid embedding; fall back to the first.
  const existingByIndex = new Map<number, { sub_goal: string | null; has_embedding: boolean }>();
  for (const row of existingRows) {
    if (row.sub_goal_index === null) continue;
    const existing = existingByIndex.get(row.sub_goal_index);
    if (!existing || (!existing.has_embedding && row.has_embedding)) {
      existingByIndex.set(row.sub_goal_index, {
        sub_goal: row.sub_goal,
        has_embedding: row.has_embedding,
      });
    }
  }

  // ── Step 3: classify each index (ok / missing / stale) ────────────
  const indexesToGenerate: number[] = [];
  let okCount = 0;
  let staleCount = 0;
  let missingCount = 0;
  for (let i = 0; i < EXPECTED_SUB_GOAL_COUNT; i++) {
    const currentSubject = currentSubjects[i]!;
    const existing = existingByIndex.get(i);
    if (!existing || !existing.has_embedding) {
      missingCount += 1;
      indexesToGenerate.push(i);
      continue;
    }
    if ((existing.sub_goal ?? '') !== currentSubject) {
      // The mandala was edited after embedding generation — regenerate.
      staleCount += 1;
      indexesToGenerate.push(i);
      continue;
    }
    okCount += 1;
  }

  // All 8 present and in sync → no work needed
  if (indexesToGenerate.length === 0) {
    log.info(
      `embeddings already present for mandala=${mandalaId} (${okCount}/${EXPECTED_SUB_GOAL_COUNT})`
    );
    return {
      ok: true,
      alreadyPresent: true,
      finalCount: okCount,
      embedMs: 0,
    };
  }

  log.info(
    `embeddings fill plan for mandala=${mandalaId}: ok=${okCount} missing=${missingCount} stale=${staleCount} → generating ${indexesToGenerate.length}`
  );

  // ── Step 4: generate via Mac Mini Ollama (only missing/stale) ─────
  const subjectsToEmbed = indexesToGenerate.map((i) => currentSubjects[i]!);
  const t0 = Date.now();
  let vectors: number[][];
  try {
    vectors = await embedBatch(subjectsToEmbed);
  } catch (err) {
    return {
      ok: false,
      alreadyPresent: false,
      finalCount: okCount,
      embedMs: Date.now() - t0,
      reason: `embedBatch failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const embedMs = Date.now() - t0;

  if (vectors.length !== indexesToGenerate.length) {
    return {
      ok: false,
      alreadyPresent: false,
      finalCount: okCount,
      embedMs,
      reason: `embedBatch returned ${vectors.length}/${indexesToGenerate.length} vectors`,
    };
  }

  // ── Step 5: DELETE stale/missing rows at those indexes, then INSERT ─
  // Only the indexes that need regeneration get DELETEd — OK rows stay.
  // Using a single DELETE with an IN clause is cleaner than per-row deletes.
  let inserted = 0;
  for (let j = 0; j < indexesToGenerate.length; j++) {
    const targetIndex = indexesToGenerate[j]!;
    const subject = currentSubjects[targetIndex]!;
    const vec = vectors[j];
    if (!vec) continue;
    const literal = vectorToLiteral(vec);
    try {
      // Delete any existing row at this specific index first (handles stale
      // rows and race conditions from concurrent writers). Scoped narrowly
      // by index — OK rows at other indexes are untouched.
      await db.$executeRaw(
        Prisma.sql`DELETE FROM mandala_embeddings
                   WHERE mandala_id = ${mandalaId} AND level = 1 AND sub_goal_index = ${targetIndex}`
      );
      await db.$executeRaw(
        Prisma.sql`INSERT INTO mandala_embeddings
                    (mandala_id, level, sub_goal_index, sub_goal, embedding, language, center_goal)
                   VALUES
                    (${mandalaId}, 1, ${targetIndex}, ${subject}, ${literal}::vector, 'ko', ${root.center_goal})`
      );
      inserted += 1;
    } catch (err) {
      log.warn(
        `embedding upsert failed for mandala=${mandalaId} sub_goal_index=${targetIndex}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  const finalCount = okCount + inserted;
  const ok = finalCount >= EXPECTED_SUB_GOAL_COUNT;
  log.info(
    `embeddings ready for mandala=${mandalaId}: ${finalCount}/${EXPECTED_SUB_GOAL_COUNT} (generated ${inserted} in ${embedMs}ms) ok=${ok}`
  );
  return {
    ok,
    alreadyPresent: false,
    finalCount,
    embedMs,
    ...(ok ? {} : { reason: `only ${finalCount}/${EXPECTED_SUB_GOAL_COUNT} rows after fill` }),
  };
}
