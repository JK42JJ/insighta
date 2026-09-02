/**
 * A stage, and the runner that holds every stage to the same contract.
 *
 * Each stage is one unit: it declares which stage it is, receives the rows the
 * stage before it passed, and returns survivors and drops. It does not touch
 * the ledger, the corpus, or the clock. The runner does all three, which is
 * what makes the guarantees pipeline-wide rather than per-author:
 *
 *   - a stage that ends without a ledger row did not happen
 *   - every dropped item names a reason, and the reasons add up (recordStep
 *     throws otherwise)
 *   - the survivors in the corpus are the survivors in the funnel, because
 *     both are written from the same return value
 *   - a stage that already has a ledger row is skipped, so a run that fails at
 *     S5 resumes from S4 instead of spending 4,000 quota units again
 *
 * Composition is `RunnableSequence` from `@langchain/core`, which is already a
 * direct dependency of this repo. LangGraph was considered and rejected: it is
 * present only as a transitive dependency of `@copilotkit/runtime` and wants
 * `@langchain/core@^1.x` against the `^0.3.80` this repo pins, so adopting it
 * means moving the version the chatbot runs on. The checkpointing it would
 * bring is already served by the corpus table, and better: resume there is a
 * SELECT against the same rows the page cites, not a second serialised state
 * that could disagree with them.
 */

import { RunnableLambda, RunnableSequence } from '@langchain/core/runnables';
import { logger } from '@/utils/logger';
import { recordStep, type PipelineStage } from '../pipeline-ledger';
import { getPrismaClient } from '@/modules/database/client';
import * as corpus from './corpus';
import type { CorpusRow } from './corpus';
import type { TopicDefinition } from '../topics/ai-tech';
import type { TopicJudge } from './judge/types';

const log = logger.child({ module: 'newsletter/pipeline' });

export interface StageContext {
  runId: string;
  topic: TopicDefinition;
  /** Who fills the LLM role. Swappable so a run can proceed without a provider. */
  judge: TopicJudge;
  /** Injected in tests and dry runs; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Written by S6 and S7, which produce a document rather than rows. */
  artifacts: Record<string, unknown>;
}

export interface StageResult {
  /** Rows that go on, with anything this stage learned about them. */
  survivors: corpus.Advance[];
  /**
   * Rows that stop here. `reason` is the key that appears in the funnel, and
   * `verdict` is the reasoning behind it when a stage has any.
   */
  drops: Array<{ videoId: string; reason: string; verdict?: Record<string, unknown> | undefined }>;
  /**
   * What this stage received, when that is not the row count it was handed.
   * S0 is the case: it consumes API responses rather than corpus rows, and
   * its drops (a video found by both layers) never become rows at all.
   */
  itemsIn?: number;
  quotaUnits?: number;
  costUsd?: number;
  /**
   * Drops that never had a corpus row — S0's duplicates. Merged into the
   * funnel's reasons so `recordStep`'s arithmetic still has to close.
   */
  rawDropReasons?: Record<string, number>;
  /** Anything that is not a count: queries used, model, shortlist ids. */
  detail?: Record<string, unknown>;
}

export interface Stage {
  id: PipelineStage;
  /** One line, shown in the run log and in the structure report. */
  what: string;
  /** 'machine' needs no model; 'model' does; 'person' is a hand-off. */
  kind: 'machine' | 'model' | 'person';
  run(input: CorpusRow[], ctx: StageContext): Promise<StageResult>;
}

/** Has this stage already run for this run? Resume asks this. */
async function alreadyRecorded(runId: string, stage: PipelineStage): Promise<boolean> {
  const rows = await getPrismaClient().$queryRaw<Array<{ n: bigint }>>`
    SELECT count(*) AS n FROM newsletter_pipeline_steps
     WHERE run_id = ${runId}::uuid AND stage = ${stage}
  `;
  return Number(rows[0]?.n ?? 0) > 0;
}

/**
 * Wrap one stage so it reads, runs, writes and records in that order.
 *
 * `previous` is the stage whose survivors are this stage's input. S0 has none:
 * it produces the corpus rather than consuming it, and returns them by seeding
 * the table itself.
 */
export function toRunnable(
  stage: Stage,
  previous: PipelineStage | null,
  ctx: StageContext
): RunnableLambda<void, void> {
  return RunnableLambda.from(async (): Promise<void> => {
    if (await alreadyRecorded(ctx.runId, stage.id)) {
      log.info('stage already recorded — skipping', { runId: ctx.runId, stage: stage.id });
      return;
    }

    const input = previous ? await corpus.readStage(ctx.runId, previous) : [];
    const t0 = Date.now();
    const result = await stage.run(input, ctx);

    // Corpus first. If recordStep then throws on unbalanced arithmetic the run
    // stops with a corpus that matches what the stage decided and no ledger
    // row, which `alreadyRecorded` reads as "did not happen" — so the retry is
    // a clean re-run rather than a double count.
    await corpus.commitStage(ctx.runId, stage.id, result.survivors, result.drops);

    const dropReasons: Record<string, number> = { ...(result.rawDropReasons ?? {}) };
    for (const d of result.drops) dropReasons[d.reason] = (dropReasons[d.reason] ?? 0) + 1;

    await recordStep({
      runId: ctx.runId,
      stage: stage.id,
      itemsIn: result.itemsIn ?? (previous ? input.length : result.survivors.length),
      itemsOut: result.survivors.length,
      dropReasons,
      quotaUnits: result.quotaUnits ?? 0,
      costUsd: result.costUsd ?? 0,
      durationMs: Date.now() - t0,
      detail: { what: stage.what, kind: stage.kind, ...(result.detail ?? {}) },
    });

    log.info('stage complete', {
      runId: ctx.runId,
      stage: stage.id,
      in: result.itemsIn ?? (previous ? input.length : result.survivors.length),
      out: result.survivors.length,
      dropped: result.drops.length,
      ms: Date.now() - t0,
    });
  });
}

/**
 * Build the pipeline from a list of (stage, predecessor) pairs.
 *
 * The predecessor is explicit rather than "the one before it in this array",
 * because a slice does not start the pipeline. Running `--from S3` still means
 * S3 reads S2's survivors; deriving the predecessor from array position made
 * the first stage of every slice behave like a producer and read nothing,
 * which is a run that silently processes zero rows and reports success.
 */
export function buildPipeline(
  steps: Array<{ stage: Stage; previous: PipelineStage | null }>,
  ctx: StageContext
): RunnableSequence<void, void> {
  const runnables = steps.map((s) => toRunnable(s.stage, s.previous, ctx));
  // RunnableSequence's type demands a first and a last step. A single-stage
  // run is a real case (re-running S3 alone after a judge change), so pad with
  // a no-op rather than special-casing the caller.
  const first = runnables[0] ?? RunnableLambda.from(async () => undefined);
  const rest = runnables.slice(1);
  const last = rest.pop() ?? RunnableLambda.from(async () => undefined);
  return RunnableSequence.from([first, ...rest, last]);
}
