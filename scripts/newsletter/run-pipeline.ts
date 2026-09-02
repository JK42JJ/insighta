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
 *   --from/--to  S0_harvest .. S7_draft      run a slice
 *   --out        path                        where the draft is written
 *
 * A stage that already has a ledger row is skipped, so re-running is safe and
 * a failure at S5 costs nothing to retry.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { startRun, finishRun, type PipelineStage } from '@/modules/newsletter/pipeline-ledger';
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

  if (judgeName === 'console' && !verdicts) {
    throw new Error('--judge console needs --verdicts <path>');
  }
  const judge =
    judgeName === 'openrouter' ? createOpenRouterJudge() : createConsoleJudge(verdicts as string);

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
  console.log(`range ${from ?? 'S0_harvest'} -> ${to ?? 'S7_draft'}\n`);

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

  if (!to || to === 'S7_draft') {
    await finishRun(runId, { status: 'complete', throughStage: 'S7_draft' });
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
