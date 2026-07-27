/**
 * One-off: judge the trend_signals rows collected before judging existed.
 *
 * Run inside the prod API container so the deployed judge and OpenRouter key are
 * the ones used:
 *   docker exec -i insighta-api node dist/scripts/backfill-topic-judge.js [--limit N]
 *
 * Lives under src/ because the image only carries src/ (Dockerfile COPY) and tsc
 * only compiles rootDir=src — a sibling of scripts/ would never reach the container.
 *
 * Ordered by the same key serving uses (fetched_at desc, norm_score desc), so a
 * partial run always covers the rows a user could actually be shown first. Safe
 * to re-run: it only selects `judge_state IS NULL`.
 */

import { getPrismaClient } from '@/modules/database/client';
import { judgeTopics, JUDGE_BATCH_SIZE } from '@/modules/curation/topic-judge';
import { logger } from '@/utils/logger';

const log = logger.child({ module: 'backfill-topic-judge' });

async function main(): Promise<void> {
  const limitArg = process.argv.indexOf('--limit');
  const limit = limitArg > -1 ? Number(process.argv[limitArg + 1]) : Number.POSITIVE_INFINITY;

  const prisma = getPrismaClient();
  const counts = { ok: 0, unsafe: 0, unfit: 0, unknown: 0 };
  let done = 0;

  for (;;) {
    if (done >= limit) break;
    const take = Math.min(JUDGE_BATCH_SIZE, limit - done);
    const rows = await prisma.trend_signals.findMany({
      where: { judge_state: null },
      orderBy: [{ fetched_at: 'desc' }, { norm_score: 'desc' }],
      take,
      select: { id: true, keyword: true },
    });
    if (rows.length === 0) break;

    const verdicts = await judgeTopics(rows.map((r) => r.keyword));
    const byKeyword = new Map(verdicts.map((v) => [v.keyword, v]));
    const judgedAt = new Date();

    for (const row of rows) {
      const v = byKeyword.get(row.keyword);
      const state =
        !v || v.degraded ? 'unknown' : !v.safe ? 'unsafe' : !v.learnable ? 'unfit' : 'ok';
      counts[state as keyof typeof counts] += 1;
      await prisma.trend_signals.update({
        where: { id: row.id },
        data: {
          judge_state: state,
          judge_reason: v && v.why ? v.why : null,
          judge_model: 'topic-judge',
          judged_at: judgedAt,
        },
      });
    }
    done += rows.length;
    log.info('backfill progress', { done, ...counts });
  }

  const remaining = await prisma.trend_signals.count({ where: { judge_state: null } });
  log.info('backfill complete', { done, remaining, ...counts });
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ done, remaining, ...counts }));
  await prisma.$disconnect();
}

main().catch((err) => {
  log.error('backfill failed', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
