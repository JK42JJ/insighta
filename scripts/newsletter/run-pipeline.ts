/**
 * Run the brief pipeline.
 *
 *   npx tsx scripts/newsletter/run-pipeline.ts --judge console \
 *     --verdicts docs/newsletter/verdicts-<run>.jsonl
 *
 * Flags
 *   --judge      console | openrouter        who fills the LLM role at S3
 *   --verdicts   path                        required by the console judge
 *   --run        uuid                        resume an existing run
 *   --from/--to  S0_harvest .. S8_evidence    run a slice
 *   --out        path                        where the draft is written
 *
 * A stage that already has a ledger row is skipped, so re-running is safe and
 * a failure at S5 costs nothing to retry.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  startRun,
  finishRun,
  PIPELINE_STAGES,
  type PipelineStage,
} from '@/modules/newsletter/pipeline-ledger';
import { pipeline, corpus } from '@/modules/newsletter/pipeline';
import { AI_TECH } from '@/modules/newsletter/topics/ai-tech';
import { createConsoleJudge } from '@/modules/newsletter/pipeline/judge/console-judge';
import { createOpenRouterJudge } from '@/modules/newsletter/pipeline/judge/openrouter-judge';
import type { StageContext } from '@/modules/newsletter/pipeline';
import { getPrismaClient } from '@/modules/database/client';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** Monday of the current ISO week, which is what an issue is dated by. */
function weekOf(d = new Date()): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = (x.getUTCDay() + 6) % 7;
  x.setUTCDate(x.getUTCDate() - day);
  return x;
}

async function main(): Promise<void> {
  const judgeName = arg('judge') ?? 'console';
  const verdicts = arg('verdicts');
  const from = arg('from') as PipelineStage | undefined;
  const to = arg('to') as PipelineStage | undefined;
  const out = arg('out') ?? 'docs/newsletter/draft.json';

  // Only S3 consults a judge, and the console judge reads its file lazily, so
  // a range that stops before S3 has no verdicts to demand. Requiring one
  // anyway made the material-only range -- harvest, format, domain -- ask for
  // a file that by definition does not exist until after that range has run.
  // The ledger's list, not a copy of it. This was a third hand-written stage
  // array -- after PIPELINE_STAGES and STAGES -- and three copies is how S8
  // came to exist in one of them and not the others.
  const ORDER: readonly PipelineStage[] = PIPELINE_STAGES;
  const LAST = ORDER[ORDER.length - 1] as PipelineStage;
  const firstIdx = from ? ORDER.indexOf(from) : 0;
  const lastIdx = to ? ORDER.indexOf(to) : ORDER.length - 1;
  const judgeInRange = firstIdx <= ORDER.indexOf('S3_judge') && ORDER.indexOf('S3_judge') <= lastIdx;

  if (judgeName === 'console' && judgeInRange && !verdicts) {
    throw new Error('--judge console needs --verdicts <path> when the range includes S3_judge');
  }
  const judge =
    judgeName === 'openrouter'
      ? createOpenRouterJudge()
      : createConsoleJudge(verdicts ?? '(not needed for this range)');

  const runId =
    arg('run') ??
    (await startRun({
      categoryKey: AI_TECH.categoryKey,
      weekOf: weekOf(),
      topicSnapshot: AI_TECH as unknown as Record<string, unknown>,
      createdBy: `pipeline-cli/${judge.name}`,
    }));

  console.log(`run   ${runId}`);
  console.log(`judge ${judge.name} (${judge.provenance})`);
  console.log(`range ${from ?? ORDER[0]} -> ${to ?? LAST}\n`);

  const ctx: StageContext = { runId, topic: AI_TECH, judge, artifacts: {} };

  try {
    await pipeline(ctx, from, to).invoke(undefined);
  } catch (err) {
    await finishRun(runId, {
      status: 'failed',
      error: err instanceof Error ? err.message : String(err),
    }).catch(() => undefined);
    throw err;
  }

  const draft = ctx.artifacts['draft'];
  if (draft) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(draft, null, 2) + '\n');
    console.log(`\ndraft written to ${out}`);
  }

  // Complete means the range reached the end of the pipeline, whatever the end
  // currently is. Pinned to S7_draft, a full run that now ends at S8 would be
  // left open and the next one would resume into a run that had finished.
  if (!to || to === LAST) {
    await finishRun(runId, { status: 'complete', throughStage: LAST });
  }

  console.log('\n=== corpus by stage ===');
  for (const row of await corpus.funnelFromCorpus(runId)) {
    console.log(`  ${row.stage.padEnd(11)} alive=${String(row.alive).padStart(5)} dropped=${String(row.dropped).padStart(5)}`);
  }

  await getPrismaClient().$disconnect();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
