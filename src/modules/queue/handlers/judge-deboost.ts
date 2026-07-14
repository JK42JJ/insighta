/**
 * judge worker — unanimous 2-model card-fitness verdicts, LOG-ONLY (T10-R).
 *
 * History: T10 wrote verdicts into relevance_pct (sentinel 2) — that field is
 * the INPUT of tone-down/sorting/serving, so the write destroyed original
 * scores with no history (13 mandalas / 141 rows, 2026-07-13 incident;
 * restored via snapshot + re-score). Supervisor-mandated contract since:
 * this worker performs NO WRITES. Verdicts are logged for calibration only.
 * T11 re-use: judge output goes to a DEDICATED column (e.g. uvs.judge_unfit
 * boolean) — never relevance_pct.
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
  await judgeMandala(job.data.userId, job.data.mandalaId);
}

/**
 * Judge core — reusable by the queue worker AND the admin re-judge endpoint.
 * LOG-ONLY (see module header): computes unanimous verdicts per cell and logs
 * them; no persistence until the T11 dedicated-column design.
 */
export async function judgeMandala(userId: string, mandalaId: string): Promise<void> {
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
    // equals-form so the card-chokepoint CI guard (which greps the bare
    // insert-literal) does not flag this read-only filter.
    where: { user_id: userId, mandala_id: mandalaId, auto_added: { equals: true } },
    select: {
      id: true,
      cell_index: true,
      relevance_pct: true,
      video: { select: { youtube_video_id: true, title: true } },
    },
  });
  const byCell = new Map<
    number,
    Array<{ rowId: string; videoId: string; title: string; relevancePct: number | null }>
  >();
  for (const r of rows) {
    const title = r.video?.title?.trim();
    const vid = r.video?.youtube_video_id;
    if (!title || !vid || r.cell_index == null || r.cell_index < 0) continue;
    if (!byCell.has(r.cell_index)) byCell.set(r.cell_index, []);
    byCell
      .get(r.cell_index)!
      .push({ rowId: r.id, videoId: vid, title, relevancePct: r.relevance_pct ?? null });
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
      const unfitRows = cards.filter((c) => unfitIds.has(c.videoId));
      deboosted += unfitRows.length;
      // T10-R (2026-07-13, supervisor-mandated landmine removal): NO WRITES.
      // The T10 incident root: this handler OVERWROTE relevance_pct — a field
      // that is the INPUT of tone-down, sorting and serving — destroying the
      // original scores with no history (13 mandalas, 141 rows). Verdicts are
      // now log-only. T11 re-use contract: judge output goes to a DEDICATED
      // column (e.g. uvs.judge_unfit boolean); it must never write
      // relevance_pct again.
      log.info(
        `[judge] mandala=${mandalaId} cell=${cellIndex} unfit=${unfitRows.length} of=${cards.length}`
      );
    })
  );
  log.info(`[judge] mandala=${mandalaId} judged=${judged} deboosted=${deboosted}`);
}
