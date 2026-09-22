/**
 * The pipeline, assembled.
 *
 * Order is the array. Each stage's input is the previous stage's survivors,
 * read from the corpus rather than passed in memory, so a run can stop and
 * resume between any two of them.
 */

import { RunnableSequence } from '@langchain/core/runnables';
import { buildPipeline, type Stage, type StageContext } from './stage';
import { s0Harvest } from './stages/s0-harvest';
import { s1Format } from './stages/s1-format';
import { s2Domain } from './stages/s2-domain';
import { s3Judge } from './stages/s3-judge';
import { s4Deep } from './stages/s4-deep';
import { s5Cross } from './stages/s5-cross';
import { s6Stats } from './stages/s6-stats';
import { s7Draft } from './stages/s7-draft';
import { makeS8Evidence } from './stages/s8-evidence';
import { proxyCaptions } from './caption-source';

export const STAGES: Stage[] = [
  s0Harvest,
  s1Format,
  s2Domain,
  s3Judge,
  s4Deep,
  s5Cross,
  s6Stats,
  s7Draft,
  // Built here rather than exported as a value because it takes its caption
  // source as an argument -- a run that must not spend a Webshare fetch passes
  // `noCaptions` instead. It was written in R4 and never added to this array,
  // so it had never run: the one thing that makes T4 measurable was dead code
  // behind a caption fetch that pointed at an endpoint which does not exist.
  makeS8Evidence(proxyCaptions()),
];

/** The whole pipeline, or a contiguous slice of it (`--from S3 --to S7`). */
export function pipeline(
  ctx: StageContext,
  from?: string,
  to?: string
): RunnableSequence<void, void> {
  const start = from ? STAGES.findIndex((s) => s.id === from) : 0;
  const end = to ? STAGES.findIndex((s) => s.id === to) : STAGES.length - 1;
  if (start < 0) throw new Error(`unknown stage ${from}`);
  if (end < 0) throw new Error(`unknown stage ${to}`);
  if (end < start) throw new Error(`${to} comes before ${from}`);
  // The predecessor comes from the full pipeline, not from the slice: S3 run
  // on its own still reads what S2 passed.
  const steps = STAGES.slice(start, end + 1).map((stage) => {
    const i = STAGES.indexOf(stage);
    return { stage, previous: i === 0 ? null : (STAGES[i - 1] as Stage).id };
  });
  return buildPipeline(steps, ctx);
}

export { buildPipeline };
export type { Stage, StageContext } from './stage';
export * as corpus from './corpus';
