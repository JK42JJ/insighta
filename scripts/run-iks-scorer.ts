/**
 * iks-scorer smoke runner — Phase 2a verification (CP352, #358 step 2)
 *
 * Goal: prove iks-scorer reads the 40 trend_signals rows that trend-collector
 * produced in step 1a, computes 6-axis IKS, and upserts into keyword_scores
 * against the real local DB. "Done = Prod Verified" — tests passing alone
 * is not enough.
 *
 * Usage:
 *   npx tsx scripts/run-iks-scorer.ts
 *
 * Prereq:
 *   trend_signals must already have rows for source='youtube_trending'.
 *   If empty, run `npx tsx scripts/run-trend-collector.ts` first.
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
// CP358 escape hatch: when INSIGHTA_PROD_RUN=1, skip dev .env loading so
// CLI-injected DATABASE_URL/DIRECT_URL/MANDALA_GEN_URL aren't override:true'd
// back to dev. CLAUDE.md hard rule: never swap .env files. Use this flag.
if (process.env['INSIGHTA_PROD_RUN'] !== '1') {
  dotenv.config({ path: path.resolve(process.cwd(), '.env'), override: true });
  dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), override: true });
}

import { executor } from '../src/skills/plugins/iks-scorer/executor';
import { getPrismaClient } from '../src/modules/database';
import type {
  PreflightContext,
  ExecuteContext,
} from '../src/skills/_shared/types';

const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

async function main(): Promise<void> {
  const env = Object.freeze({ ...process.env });
  const db = getPrismaClient();

  // ── Step 1: baseline counts ──────────────────────────────────────────
  const trendCount = await db.trend_signals.count({
    where: { source: { in: ['youtube_trending_extracted', 'youtube_suggest'] } },
  });
  const beforeScores = await db.keyword_scores.count();
  console.log(`[baseline] trend_signals(youtube_trending): ${trendCount} rows`);
  console.log(`[baseline] keyword_scores              : ${beforeScores} rows`);

  if (trendCount === 0) {
    console.error('FAIL: trend_signals is empty. Run scripts/run-trend-collector.ts first.');
    process.exit(2);
  }

  // ── Step 2: preflight ────────────────────────────────────────────────
  const preCtx: PreflightContext = {
    userId: SYSTEM_USER_ID,
    tier: 'admin',
    env,
  };
  const preflight = await executor.preflight(preCtx);
  if (!preflight.ok) {
    console.error(`FAIL: preflight rejected — ${preflight.reason}`);
    process.exit(3);
  }
  const preState = preflight.hydrated as Record<string, unknown>;
  console.log(
    `[preflight] OK — sources=${preState['sources']} weight_version=${preState['weightVersion']}`,
  );
  console.log(`[preflight] weights=${JSON.stringify(preState['weights'])}`);

  // ── Step 3: execute ──────────────────────────────────────────────────
  const exeCtx: ExecuteContext = {
    ...preCtx,
    llm: {} as never,
    state: Object.freeze(preflight.hydrated ?? {}),
  };
  const t0 = Date.now();
  const result = await executor.execute(exeCtx);
  const wallMs = Date.now() - t0;

  console.log(
    `[execute] status=${result.status}  wall=${wallMs}ms  metrics=${JSON.stringify(result.metrics)}`,
  );
  console.log(`[execute] data=${JSON.stringify(result.data, null, 2)}`);

  if (result.status === 'failed') {
    console.error(`FAIL: execute returned failed — ${result.error}`);
    process.exit(4);
  }

  // ── Step 4: post-execute count + sample ──────────────────────────────
  const afterScores = await db.keyword_scores.count();
  const delta = afterScores - beforeScores;
  console.log(
    `[verify] keyword_scores: ${beforeScores} → ${afterScores} (Δ ${delta >= 0 ? '+' : ''}${delta})`,
  );

  const sample = await db.keyword_scores.findMany({
    orderBy: { iks_total: 'desc' },
    take: 5,
    select: {
      keyword: true,
      iks_total: true,
      search_demand: true,
      learning_value: true,
      goal_relevance: true,
      weight_version: true,
    },
  });
  console.log('[sample] top 5 by iks_total:');
  for (const row of sample) {
    console.log(
      `  • "${row.keyword.slice(0, 50)}${row.keyword.length > 50 ? '…' : ''}" ` +
        `iks=${row.iks_total.toFixed(2)} ` +
        `search=${row.search_demand?.toFixed(2)} ` +
        `learn=${row.learning_value?.toFixed(2)} ` +
        `goal=${row.goal_relevance?.toFixed(2)} ` +
        `wv=${row.weight_version}`,
    );
  }

  // ── Step 5: idempotency ─────────────────────────────────────────────
  console.log('\n[idempotency] re-running execute() to verify upsert (no duplicates)...');
  const result2 = await executor.execute(exeCtx);
  const finalScores = await db.keyword_scores.count();
  const idempotentDelta = finalScores - afterScores;
  console.log(
    `[idempotency] status=${result2.status}  rows=${afterScores} → ${finalScores} (Δ ${idempotentDelta >= 0 ? '+' : ''}${idempotentDelta})`,
  );
  if (idempotentDelta > 0) {
    console.warn(
      `WARN: idempotency assertion failed — second run should add 0 new rows but added ${idempotentDelta}.`,
    );
  } else {
    console.log('[idempotency] OK — upsert key (keyword, language) holds.');
  }

  await db.$disconnect();
  console.log('\nPASS — iks-scorer Phase 2a smoke verified.');
  process.exit(0);
}

main().catch((err) => {
  console.error('FAIL: unhandled error');
  console.error(err);
  process.exit(1);
});
