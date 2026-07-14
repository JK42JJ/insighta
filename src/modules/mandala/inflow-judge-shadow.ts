/**
 * T11 Stage1 — inflow judge shadow runner (design 2026-07-14, supervisor GO).
 *
 * Called fire-and-forget AFTER the precompute row is marked done (post-done
 * race — the SLA path never waits on this). Runs the unanimous 2-model judge
 * per cell over the precomputed slots and stores verdicts + the supervisor's
 * four shadow metrics in the DEDICATED judge_verdicts column:
 *
 *   split rate            — legs disagree / judged (3-model 재론 트리거 데이터)
 *   directional split     — gA-only unfit vs gB-only unfit (계통 편향 검출)
 *   would-drop (floored)  — unfit above the per-cell floor (Stage2 preview)
 *   verdict arrival race  — consume compares consumed_at vs computed_at
 *
 * Shadow contract: NO effect on placement; NO writes outside judge_verdicts.
 */

import { Prisma } from '@prisma/client';
import { getPrismaClient } from '@/modules/database/client';
import { judgeCellCardsDetailed } from '@/modules/judge/card-cell-judge';
import { planCellFloor, type CellVerdictInput } from '@/config/t11-inflow-judge';
import { loadPoolServeConfig } from '@/config/pool-serve';
import { logger } from '@/utils/logger';

const log = logger.child({ module: 'inflow-judge-shadow' });

export interface InflowSlot {
  videoId: string;
  title: string;
  cellIndex: number;
}

export async function runInflowJudgeShadow(input: {
  sessionId: string;
  centerGoal: string;
  subGoals: string[];
  slots: InflowSlot[];
}): Promise<void> {
  const t0 = Date.now();
  try {
    const byCell = new Map<number, InflowSlot[]>();
    for (const s of input.slots) {
      if (s.cellIndex == null || s.cellIndex < 0 || !s.title) continue;
      if (!byCell.has(s.cellIndex)) byCell.set(s.cellIndex, []);
      byCell.get(s.cellIndex)!.push(s);
    }
    if (byCell.size === 0) return;

    let judged = 0;
    let split = 0;
    let gaOnlyUnfit = 0;
    let gbOnlyUnfit = 0;
    const verdictInputs: CellVerdictInput[] = [];
    const cells: Record<string, { videoId: string; fit: boolean; legs: boolean[] }[]> = {};

    await Promise.all(
      [...byCell.entries()].map(async ([cellIndex, slots]) => {
        const cellTopic = input.subGoals[cellIndex]?.trim();
        if (!cellTopic) return;
        const detailed = await judgeCellCardsDetailed({
          centerGoal: input.centerGoal,
          cellTopic,
          items: slots.map((s) => ({ videoId: s.videoId, title: s.title })),
        });
        const cellOut: { videoId: string; fit: boolean; legs: boolean[] }[] = [];
        detailed.final.forEach((v, i) => {
          judged += 1;
          const legFits = detailed.legs.map((leg) => leg.verdicts[i]?.fit !== false);
          const [ga, gb] = [legFits[0] !== false, legFits[1] !== false];
          if (ga !== gb) {
            split += 1;
            if (!ga && gb) gaOnlyUnfit += 1;
            if (ga && !gb) gbOnlyUnfit += 1;
          }
          verdictInputs.push({ videoId: v.videoId, cellIndex, fit: v.fit });
          cellOut.push({ videoId: v.videoId, fit: v.fit, legs: legFits });
        });
        cells[String(cellIndex)] = cellOut;
      })
    );

    const minPerCell = loadPoolServeConfig().minPerCell;
    const floor = planCellFloor(verdictInputs, minPerCell);

    const payload = {
      schema: 1,
      computed_at: new Date().toISOString(),
      duration_ms: Date.now() - t0,
      metrics: {
        judged,
        unanimous_unfit: verdictInputs.filter((v) => !v.fit).length,
        split,
        ga_only_unfit: gaOnlyUnfit,
        gb_only_unfit: gbOnlyUnfit,
        would_drop_after_floor: floor.wouldDrop.length,
        kept_despite_unfit: floor.keptDespiteUnfit.length,
        min_per_cell: minPerCell,
      },
      would_drop: floor.wouldDrop,
      kept_despite_unfit: floor.keptDespiteUnfit,
      cells,
    };

    const db = getPrismaClient();
    await db.mandala_wizard_precompute.update({
      where: { session_id: input.sessionId },
      data: { judge_verdicts: payload as unknown as Prisma.InputJsonValue },
    });
    log.info(
      `[t11-shadow] session=${input.sessionId} judged=${judged} unfit=${payload.metrics.unanimous_unfit} ` +
        `split=${split} (gaOnly=${gaOnlyUnfit} gbOnly=${gbOnlyUnfit}) wouldDrop=${floor.wouldDrop.length} ` +
        `keptDespiteUnfit=${floor.keptDespiteUnfit.length} duration_ms=${payload.duration_ms}`
    );
  } catch (err) {
    // Shadow must never disturb anything — swallow (row may be TTL-swept).
    log.warn(
      `[t11-shadow] failed (non-fatal): session=${input.sessionId} ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
