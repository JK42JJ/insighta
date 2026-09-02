/**
 * The judge that is a person at a console.
 *
 * S3 decides three things about a candidate — safe, learnable, in scope — and
 * a model is one way to decide them, not the only one. This judge reads
 * verdicts from a JSONL file written by whoever did the judging. It exists for
 * two reasons that are not "the provider is down":
 *
 *   1. It makes S3's dependency explicit. A stage that can only run when an
 *      account has credit is a stage the rest of the pipeline cannot be tested
 *      against, and the pipeline was never run end to end because of it.
 *   2. It is the more auditable of the two. A model samples a reason; a person
 *      writes one. Both land in `newsletter_corpus.verdict` with the judge
 *      named, so a reader can tell them apart.
 *
 * It refuses to guess. A candidate with no line in the file is an error, not a
 * rejection and not a pass — silently dropping unjudged items is exactly how a
 * page ends up citing a review that did not happen.
 *
 * File format, one JSON object per line:
 *   {"videoId":"abc...","safe":true,"learnable":true,"inScope":true,"why":"..."}
 */

import { readFileSync } from 'node:fs';
import { logger } from '@/utils/logger';
import { JudgeError, type JudgeCandidate, type JudgeVerdict, type TopicJudge } from './types';

const log = logger.child({ module: 'newsletter/judge/console' });

interface Line {
  videoId?: unknown;
  safe?: unknown;
  learnable?: unknown;
  inScope?: unknown;
  why?: unknown;
}

function parse(path: string): Map<string, JudgeVerdict> {
  const out = new Map<string, JudgeVerdict>();
  const text = readFileSync(path, 'utf8');
  let lineNo = 0;
  for (const raw of text.split('\n')) {
    lineNo += 1;
    const line = raw.trim();
    if (!line || line.startsWith('//')) continue;

    let obj: Line;
    try {
      obj = JSON.parse(line) as Line;
    } catch {
      throw new JudgeError(`${path}:${lineNo} is not JSON`);
    }

    // Typed, not coerced. `"safe": "false"` is a string and would be truthy;
    // a verdict file that says the opposite of what it means is worse than a
    // missing one, because nothing downstream can tell.
    const { videoId, safe, learnable, inScope, why } = obj;
    if (typeof videoId !== 'string' || videoId.length === 0) {
      throw new JudgeError(`${path}:${lineNo} has no videoId`);
    }
    for (const [k, v] of [
      ['safe', safe],
      ['learnable', learnable],
      ['inScope', inScope],
    ] as const) {
      if (typeof v !== 'boolean') {
        throw new JudgeError(
          `${path}:${lineNo} (${videoId}): ${k} must be true or false, got ${JSON.stringify(v)}`
        );
      }
    }
    if (typeof why !== 'string' || why.trim().length === 0) {
      throw new JudgeError(`${path}:${lineNo} (${videoId}): every verdict needs a reason`);
    }
    if (out.has(videoId)) {
      throw new JudgeError(`${path}:${lineNo}: ${videoId} judged twice`);
    }

    out.set(videoId, {
      videoId,
      safe: safe as boolean,
      learnable: learnable as boolean,
      inScope: inScope as boolean,
      why: why.trim(),
    });
  }
  return out;
}

export function createConsoleJudge(verdictsPath: string): TopicJudge {
  let cache: Map<string, JudgeVerdict> | null = null;

  return {
    name: 'console',
    provenance: verdictsPath,
    async judge(candidates: JudgeCandidate[]): Promise<JudgeVerdict[]> {
      cache ??= parse(verdictsPath);
      const verdicts = cache;

      const missing = candidates.filter((c) => !verdicts.has(c.videoId));
      if (missing.length > 0) {
        throw new JudgeError(
          `${missing.length} of ${candidates.length} candidates have no verdict in ${verdictsPath}` +
            ` — first: ${missing[0]?.videoId} "${missing[0]?.title.slice(0, 60)}".` +
            ' An unjudged candidate is neither a pass nor a rejection.'
        );
      }

      log.info('console judge answered', {
        candidates: candidates.length,
        file: verdictsPath,
      });
      return candidates.map((c) => verdicts.get(c.videoId) as JudgeVerdict);
    },
  };
}
