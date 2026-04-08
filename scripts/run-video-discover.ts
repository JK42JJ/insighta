/**
 * video-discover smoke runner — Phase 3 verification (CP352, #358 / #361)
 *
 * What it does:
 *   1. Picks a real OAuth-connected user from local DB
 *   2. Picks one of that user's mandalas (with 8 sub_goals)
 *   3. If mandala has no level=1 embeddings yet → embed sub_goals via Mac Mini
 *      and INSERT into mandala_embeddings (one-shot bootstrap)
 *   4. Runs executor.preflight() + executor.execute()
 *   5. Verifies recommendation_cache rows + prints sample
 *
 * Usage:
 *   npx tsx scripts/run-video-discover.ts
 *
 * Prereq:
 *   - keyword_scores has rows with embeddings (Phase 2b — done)
 *   - User has youtube_sync_settings with valid OAuth token
 *   - Mac Mini Ollama reachable (for sub_goal embedding bootstrap)
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
// CP358 escape hatch — see CLAUDE.md ".env 불변" hard rule.
if (process.env['INSIGHTA_PROD_RUN'] !== '1') {
  dotenv.config({ path: path.resolve(process.cwd(), '.env'), override: true });
  dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), override: true });
}

import { executor } from '../src/skills/plugins/video-discover/executor';
import { getPrismaClient } from '../src/modules/database';
import { embedBatch, vectorToLiteral } from '../src/skills/plugins/iks-scorer/embedding';
import { Prisma } from '@prisma/client';
import type {
  PreflightContext,
  ExecuteContext,
} from '../src/skills/_shared/types';

async function main(): Promise<void> {
  const env = Object.freeze({ ...process.env });
  void env;
  const db = getPrismaClient();

  // ── Step 1: pick an OAuth-connected user with a mandala that has 8 sub_goals
  const candidates = await db.$queryRaw<{ user_id: string; mandala_id: string; title: string; center_goal: string; subjects: string[] }[]>(
    Prisma.sql`SELECT m.user_id, m.id AS mandala_id, coalesce(m.title, '?') AS title,
                      l.center_goal, l.subjects
               FROM user_mandalas m
               JOIN user_mandala_levels l ON l.mandala_id = m.id AND l.depth = 0
               JOIN youtube_sync_settings y ON y.user_id = m.user_id
               WHERE y.youtube_access_token IS NOT NULL
                 AND (y.youtube_token_expires_at IS NULL OR y.youtube_token_expires_at > now())
                 AND array_length(l.subjects, 1) >= 8
               ORDER BY m.created_at DESC
               LIMIT 1`,
  );

  if (candidates.length === 0) {
    console.error('FAIL: no OAuth-connected user with an 8-sub_goal mandala found');
    process.exit(2);
  }
  const c = candidates[0]!;
  console.log(`[picked] user=${c.user_id}`);
  console.log(`[picked] mandala=${c.mandala_id} "${c.title}"`);
  console.log(`[picked] sub_goals=${c.subjects.length}`);

  // ── Step 2: bootstrap mandala_embeddings if missing (level=1, 8 rows) ──
  const existing = await db.$queryRaw<{ count: bigint }[]>(
    Prisma.sql`SELECT count(*)::bigint AS count FROM mandala_embeddings WHERE mandala_id = ${c.mandala_id} AND level = 1 AND embedding IS NOT NULL`,
  );
  const embCount = Number(existing[0]?.count ?? 0);
  if (embCount < 8) {
    console.log(`[bootstrap] mandala has ${embCount}/8 embeddings — embedding sub_goals via Mac Mini...`);
    const tEmb = Date.now();
    const vectors = await embedBatch(c.subjects);
    console.log(`[bootstrap] embedded 8 sub_goals in ${Date.now() - tEmb}ms`);

    // Wipe any partial rows + insert fresh
    await db.$executeRaw(
      Prisma.sql`DELETE FROM mandala_embeddings WHERE mandala_id = ${c.mandala_id} AND level = 1`,
    );
    for (let i = 0; i < c.subjects.length; i++) {
      const text = c.subjects[i] ?? '';
      const vec = vectors[i];
      if (!vec) continue;
      const literal = vectorToLiteral(vec);
      await db.$executeRaw(
        Prisma.sql`INSERT INTO mandala_embeddings (mandala_id, level, sub_goal_index, sub_goal, embedding, language, center_goal)
                   VALUES (${c.mandala_id}, 1, ${i}, ${text}, ${literal}::vector, 'ko', ${c.center_goal})`,
      );
    }
    console.log(`[bootstrap] inserted 8 mandala_embeddings rows`);
  } else {
    console.log(`[bootstrap] skipped — mandala already has ${embCount} embeddings`);
  }

  // ── Step 3: baseline rec count ─────────────────────────────────────────
  const beforeRecs = await db.recommendation_cache.count({
    where: { user_id: c.user_id, mandala_id: c.mandala_id },
  });
  console.log(`[baseline] recommendation_cache for this user × mandala: ${beforeRecs} rows`);

  // ── Step 4: preflight ──────────────────────────────────────────────────
  const preCtx: PreflightContext = {
    userId: c.user_id,
    mandalaId: c.mandala_id,
    tier: 'admin',
    env: {},
  };
  const preflight = await executor.preflight(preCtx);
  if (!preflight.ok) {
    console.error(`FAIL: preflight rejected — ${preflight.reason}`);
    process.exit(3);
  }
  const preState = preflight.hydrated as Record<string, unknown>;
  console.log(
    `[preflight] OK — sub_goals=${(preState['subGoals'] as unknown[]).length}, keywords=${(preState['keywords'] as unknown[]).length}, oauth=present`,
  );

  // ── Step 5: execute ────────────────────────────────────────────────────
  const exeCtx: ExecuteContext = {
    ...preCtx,
    llm: {} as never,
    state: Object.freeze(preflight.hydrated ?? {}),
  };
  const t0 = Date.now();
  const result = await executor.execute(exeCtx);
  const wallMs = Date.now() - t0;

  console.log(`[execute] status=${result.status}  wall=${wallMs}ms`);
  console.log(`[execute] data=${JSON.stringify(result.data, null, 2)}`);

  if (result.status === 'failed') {
    console.error(`FAIL: ${result.error}`);
    process.exit(4);
  }

  // ── Step 6: verify + sample ────────────────────────────────────────────
  const afterRecs = await db.recommendation_cache.count({
    where: { user_id: c.user_id, mandala_id: c.mandala_id },
  });
  console.log(`[verify] recommendation_cache: ${beforeRecs} → ${afterRecs} (Δ +${afterRecs - beforeRecs})`);

  const sample = await db.recommendation_cache.findMany({
    where: { user_id: c.user_id, mandala_id: c.mandala_id },
    orderBy: { rec_score: 'desc' },
    take: 8,
    select: {
      cell_index: true,
      keyword: true,
      title: true,
      channel: true,
      view_count: true,
      rec_score: true,
      iks_score: true,
      rec_reason: true,
    },
  });
  console.log('\n[sample] top 8 by rec_score:');
  for (const r of sample) {
    const titlePreview = (r.title ?? '').slice(0, 50);
    console.log(
      `  cell=${r.cell_index} kw="${r.keyword}" rec=${r.rec_score?.toFixed(2)} iks=${r.iks_score?.toFixed(0)} views=${r.view_count?.toLocaleString() ?? '?'} ch="${r.channel}" "${titlePreview}${(r.title ?? '').length > 50 ? '…' : ''}"`,
    );
  }

  await db.$disconnect();
  console.log('\nPASS — video-discover Phase 3 smoke verified.');
  process.exit(0);
}

main().catch((err) => {
  console.error('FAIL: unhandled error');
  console.error(err);
  process.exit(1);
});
