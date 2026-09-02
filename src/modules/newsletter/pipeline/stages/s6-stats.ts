/**
 * S6 — the funnel, read back out of the ledger.
 *
 * This stage computes nothing. It reads `newsletter_pipeline_steps` and the
 * corpus and asserts they agree, then hands the result to S7 as the only
 * numbers a page is allowed to print about its own process.
 *
 * The assertion is the point. Issue 1's funnel said "2,714 harvested, 1,042
 * reviewed" and cited Insighta's own count; nothing could contradict it
 * because nothing else had counted. Here the same figure exists twice — once
 * as a step row, once as a set of corpus rows — and a disagreement stops the
 * run rather than reaching a reader.
 */

import { readFunnel, type PipelineStage } from '../../pipeline-ledger';
import * as corpus from '../corpus';
import type { CorpusRow } from '../corpus';
import type { Stage, StageContext, StageResult } from '../stage';

export class FunnelMismatch extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FunnelMismatch';
  }
}

export const s6Stats: Stage = {
  id: 'S6_stats',
  what: 'reconcile the ledger against the corpus',
  kind: 'machine',

  async run(input: CorpusRow[], ctx: StageContext): Promise<StageResult> {
    const funnel = await readFunnel(ctx.runId);
    const all = await corpus.readAll(ctx.runId);

    // Every row the corpus says a stage dropped must appear in that stage's
    // ledger reasons, with the same count and the same key.
    const corpusDrops = new Map<string, Record<string, number>>();
    for (const row of all) {
      if (!row.droppedAtStage || !row.dropReason) continue;
      const forStage = corpusDrops.get(row.droppedAtStage) ?? {};
      forStage[row.dropReason] = (forStage[row.dropReason] ?? 0) + 1;
      corpusDrops.set(row.droppedAtStage, forStage);
    }

    const mismatches: string[] = [];
    for (const stage of funnel.stages) {
      const fromCorpus = corpusDrops.get(stage.stage) ?? {};
      for (const [reason, n] of Object.entries(fromCorpus)) {
        const ledgerN = stage.dropReasons[reason] ?? 0;
        if (ledgerN !== n) {
          mismatches.push(`${stage.stage}/${reason}: ledger ${ledgerN}, corpus ${n}`);
        }
      }
    }
    if (mismatches.length > 0) {
      throw new FunnelMismatch(
        `the ledger and the corpus disagree — ${mismatches.join('; ')}. ` +
          'A funnel that cannot be reproduced from the rows does not go on a page.'
      );
    }

    // The shape a page prints. Buckets follow FunnelBucketSchema's four keys.
    const byStage = new Map<PipelineStage, (typeof funnel.stages)[number]>(
      funnel.stages.map((s) => [s.stage, s])
    );
    const dropsAt = (s: PipelineStage): number => {
      const row = byStage.get(s);
      if (!row) return 0;
      return Object.values(row.dropReasons).reduce((a, b) => a + b, 0);
    };

    const buckets = [
      { key: 'form' as const, count: dropsAt('S1_format'), label: '형식 미달' },
      {
        key: 'rule' as const,
        count: dropsAt('S2_domain') + dropsAt('S3_judge'),
        label: '주제·판정 탈락',
      },
      {
        key: 'solo' as const,
        count: input.filter((v) => {
          const c = (v.corroboration ?? {}) as { independentChannels?: number };
          return (c.independentChannels ?? 0) < 3;
        }).length,
        label: '단일 출처',
      },
      {
        key: 'cross' as const,
        count: input.filter((v) => {
          const c = (v.corroboration ?? {}) as { independentChannels?: number };
          return (c.independentChannels ?? 0) >= 3;
        }).length,
        label: '교차 확인',
      },
    ];

    ctx.artifacts['funnel'] = {
      quotaUnits: funnel.quotaUnits,
      stages: funnel.stages,
      buckets,
      harvested: byStage.get('S0_harvest')?.itemsOut ?? 0,
      reviewed: byStage.get('S3_judge')?.itemsIn ?? 0,
      shortlist: input.length,
    };

    return {
      survivors: input.map((v) => ({ videoId: v.videoId })),
      drops: [],
      detail: { buckets, reconciledStages: funnel.stages.length, mismatches: 0 },
    };
  },
};
