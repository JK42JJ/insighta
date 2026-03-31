#!/usr/bin/env npx tsx
/**
 * Backfill script: generate rich summaries for existing video_summaries entries
 * that don't yet have a video_rich_summaries row.
 *
 * Usage: npx ts-node scripts/backfill-rich-summaries.ts [--limit N] [--dry-run]
 *
 * NOT auto-executed. Run manually when needed.
 */

import { getPrismaClient } from '../src/modules/database/client';
import { enrichRichSummary } from '../src/modules/skills/rich-summary';
import { logger } from '../src/utils/logger';

const log = logger.child({ module: 'BackfillRichSummaries' });

const DEFAULT_BATCH_LIMIT = 50;
const DELAY_BETWEEN_VIDEOS_MS = 2000;

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx >= 0 ? Number(args[limitIdx + 1]) : DEFAULT_BATCH_LIMIT;

  const prisma = getPrismaClient();

  // Find video_summaries entries without a corresponding video_rich_summaries row
  const candidates = await prisma.$queryRaw<
    { video_id: string; title: string | null; summary_en: string | null }[]
  >`
    SELECT vs.video_id, vs.title, vs.summary_en
    FROM public.video_summaries vs
    LEFT JOIN public.video_rich_summaries vrs ON vrs.video_id = vs.video_id
    WHERE vrs.video_id IS NULL
      AND vs.summary_en IS NOT NULL
      AND vs.summary_en != ''
    ORDER BY vs.created_at DESC
    LIMIT ${limit}
  `;

  log.info('Backfill candidates found', { count: candidates.length, limit, dryRun });

  if (dryRun) {
    for (const c of candidates) {
      log.info('Would backfill', { videoId: c.video_id, title: c.title?.slice(0, 50) });
    }
    log.info('Dry run complete', { total: candidates.length });
    return;
  }

  let success = 0;
  let failed = 0;

  for (const candidate of candidates) {
    try {
      const result = await enrichRichSummary(candidate.video_id, {
        title: candidate.title ?? candidate.video_id,
        description: candidate.summary_en ?? undefined,
      });
      log.info('Backfill complete', {
        videoId: candidate.video_id,
        qualityFlag: result.qualityFlag,
        score: result.qualityScore,
      });
      success++;
    } catch (err) {
      log.error('Backfill failed', {
        videoId: candidate.video_id,
        error: err instanceof Error ? err.message : String(err),
      });
      failed++;
    }

    // Rate limiting to avoid LLM API overload
    await new Promise((resolve) => setTimeout(resolve, DELAY_BETWEEN_VIDEOS_MS));
  }

  log.info('Backfill complete', { success, failed, total: candidates.length });
}

main().catch((err) => {
  log.error('Backfill script failed', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
