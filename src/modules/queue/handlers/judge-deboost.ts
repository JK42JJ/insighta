/**
 * judge-deboost worker — gA fitness deboost per mandala (2026-07-12).
 *
 * Runs ONCE per mandala creation (singletonKey, startAfter 240s so the
 * quick-relevance backfill mostly lands first). For each cell it batches the
 * placed card TITLES through the gA judge (card-cell-judge.ts); unfit cards
 * are DEBOOSTED — relevance_pct forced low on user_video_states +
 * recommendation_cache — never deleted (single-judge removal is unsafe:
 * report benchmark false-blocks 19-22%). 관련도순 default sort sinks them.
 *
 * Fail-open everywhere: judge/provider errors leave cards untouched.
 */
import type PgBoss from 'pg-boss';
import { getPrismaClient } from '@/modules/database/client';
import { judgeCellCards } from '@/modules/judge/card-cell-judge';
import { isJudgeDeboostEnabled } from '@/config/judge-deboost';
import { logger } from '@/utils/logger';
import { getJobQueue } from '../manager';
import { JOB_NAMES, JUDGE_DEBOOST_RETRY_OPTIONS, type JudgeDeboostPayload } from '../types';

const log = logger.child({ module: 'judge-deboost' });

/** Deboosted rank value — far below 추천(70)/핵심(80) and the NULL-recency band (≤60). */
const UNFIT_RELEVANCE_PCT = 2;
const JUDGE_DELAY_SEC = 240;

export async function enqueueJudgeDeboost(payload: JudgeDeboostPayload): Promise<string | null> {
  const boss = getJobQueue().getInstance();
  return boss.send(JOB_NAMES.JUDGE_DEBOOST, payload, {
    ...JUDGE_DEBOOST_RETRY_OPTIONS,
    singletonKey: `judge-deboost-${payload.mandalaId}`,
    startAfter: JUDGE_DELAY_SEC,
  });
}

export async function registerJudgeDeboostWorker(): Promise<void> {
  const boss = getJobQueue().getInstance();
  await boss.work<JudgeDeboostPayload>(JOB_NAMES.JUDGE_DEBOOST, handleJudgeDeboost);
  log.info('judge-deboost worker registered');
}

export async function handleJudgeDeboost(
  jobs: PgBoss.Job<JudgeDeboostPayload> | PgBoss.Job<JudgeDeboostPayload>[]
): Promise<void> {
  const job = Array.isArray(jobs) ? jobs[0] : jobs;
  if (!job) return;
  if (!isJudgeDeboostEnabled()) return;
  const { userId, mandalaId } = job.data;
  const prisma = getPrismaClient();

  // Cell topics from the root level's subjects.
  const root = await prisma.user_mandala_levels.findFirst({
    where: { mandala_id: mandalaId, depth: 0 },
    select: { center_goal: true, subjects: true },
  });
  const centerGoal = root?.center_goal ?? '';
  const subjects = (root?.subjects ?? []).filter((s): s is string => typeof s === 'string');
  if (!centerGoal || subjects.length === 0) return;

  // Placed auto-added cards with titles, grouped by cell.
  const rows = await prisma.userVideoState.findMany({
    where: { user_id: userId, mandala_id: mandalaId, auto_added: true },
    select: {
      id: true,
      cell_index: true,
      video: { select: { youtube_video_id: true, title: true } },
    },
  });
  const byCell = new Map<number, Array<{ rowId: string; videoId: string; title: string }>>();
  for (const r of rows) {
    const title = r.video?.title?.trim();
    const vid = r.video?.youtube_video_id;
    if (!title || !vid || r.cell_index == null || r.cell_index < 0) continue;
    if (!byCell.has(r.cell_index)) byCell.set(r.cell_index, []);
    byCell.get(r.cell_index)!.push({ rowId: r.id, videoId: vid, title });
  }
  if (byCell.size === 0) return;

  let judged = 0;
  let deboosted = 0;
  await Promise.allSettled(
    [...byCell.entries()].map(async ([cellIndex, cards]) => {
      const cellTopic = subjects[cellIndex]?.trim();
      if (!cellTopic) return;
      const verdicts = await judgeCellCards({
        centerGoal,
        cellTopic,
        items: cards.map((c) => ({ videoId: c.videoId, title: c.title })),
      });
      judged += verdicts.length;
      const unfitIds = new Set(verdicts.filter((v) => !v.fit).map((v) => v.videoId));
      if (unfitIds.size === 0) return;
      const unfitRows = cards.filter((c) => unfitIds.has(c.videoId));
      deboosted += unfitRows.length;
      await prisma.userVideoState.updateMany({
        where: { id: { in: unfitRows.map((c) => c.rowId) } },
        data: { relevance_pct: UNFIT_RELEVANCE_PCT },
      });
      // Mirror on recommendation_cache so re-serves keep the sink.
      await prisma.recommendation_cache
        .updateMany({
          where: { mandala_id: mandalaId, video_id: { in: unfitRows.map((c) => c.videoId) } },
          data: { relevance_pct: UNFIT_RELEVANCE_PCT },
        })
        .catch(() => undefined);
      log.info(
        `[judge] mandala=${mandalaId} cell=${cellIndex} unfit=${unfitRows.length}/${cards.length}`
      );
    })
  );
  log.info(`[judge] mandala=${mandalaId} judged=${judged} deboosted=${deboosted}`);
}
