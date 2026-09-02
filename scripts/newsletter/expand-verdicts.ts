/**
 * Turn an editor's decision sheet into the verdict file S3 reads.
 *
 * Judging 440 candidates means writing 440 reasons, and a reason retyped 200
 * times stops being read. The sheet records one decision code per video; the
 * codes are defined here, once, with the wording that goes into
 * `newsletter_corpus.verdict.why`. A per-video note may follow the code and is
 * appended to it.
 *
 * The codes are the editorial policy, so they live in the repo rather than in
 * a chat log: a reader asking why a video was rejected gets the same sentence
 * every time, and changing the policy is a diff.
 *
 *   sheet line:  <videoId> <code> [free text]
 *   comment:     # ...
 *
 *   npx tsx scripts/newsletter/expand-verdicts.ts sheet.txt > verdicts.jsonl
 */

import { readFileSync } from 'node:fs';

interface Code {
  safe: boolean;
  learnable: boolean;
  inScope: boolean;
  why: string;
}

/**
 * Three axes, kept independent.
 *
 * `learnable: false` is not a judgement about quality — a reaction video can
 * be well made. It says there is nothing in it a working engineer can apply,
 * which is the only thing this brief promises.
 */
export const CODES: Record<string, Code> = {
  // passes
  ok: { safe: true, learnable: true, inScope: true, why: 'first-hand technical material on AI engineering' },
  build: { safe: true, learnable: true, inScope: true, why: 'hands-on build or deployment account' },
  infra: { safe: true, learnable: true, inScope: true, why: 'inference, serving or model infrastructure' },
  eval: { safe: true, learnable: true, inScope: true, why: 'measurement or evaluation with results' },
  sec: { safe: true, learnable: true, inScope: true, why: 'security or safety of AI systems, with specifics' },
  agent: { safe: true, learnable: true, inScope: true, why: 'agent design or tooling, from practice' },

  // in scope, nothing to act on
  news: { safe: true, learnable: false, inScope: true, why: 'news roundup with no first-hand material' },
  hype: { safe: true, learnable: false, inScope: true, why: 'reaction or announcement with nothing to act on' },
  vision: { safe: true, learnable: false, inScope: true, why: 'vision talk; no technique a practitioner can apply' },
  promo: { safe: true, learnable: false, inScope: true, why: 'vendor positioning rather than technique' },
  beginner: { safe: true, learnable: false, inScope: true, why: 'beginner course or bootcamp promotion' },
  income: { safe: true, learnable: false, inScope: true, why: 'income claim rather than technique' },
  profile: { safe: true, learnable: false, inScope: true, why: 'profile or interview; no applicable technique' },

  // outside this brief's boundary
  gtm: { safe: true, learnable: true, inScope: false, why: 'go-to-market and sales, not AI engineering' },
  org: { safe: true, learnable: true, inScope: false, why: 'organisational structure, not AI engineering' },
  policy: { safe: true, learnable: true, inScope: false, why: 'policy and governance, not AI engineering' },
  general: { safe: true, learnable: true, inScope: false, why: 'general software engineering; belongs to the dev brief' },
  offtopic: { safe: true, learnable: true, inScope: false, why: 'not about AI' },
  // S2 checks the title's script, which is Latin for German, Italian,
  // Portuguese and romanised Hindi alike. The spoken language only becomes
  // visible at S4, one stage later, so it lands here.
  lang: { safe: true, learnable: true, inScope: false, why: 'not in a language this brief serves' },

  // refused outright
  unsafe: { safe: false, learnable: false, inScope: false, why: 'not a study subject' },
};

function main(): void {
  const path = process.argv[2];
  if (!path) throw new Error('usage: expand-verdicts.ts <sheet>');

  const seen = new Set<string>();
  const out: string[] = [];
  let lineNo = 0;

  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    lineNo += 1;
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    const [videoId, code, ...rest] = line.split(/\s+/);
    if (!videoId || !code) throw new Error(`${path}:${lineNo}: expected "<videoId> <code>"`);
    const def = CODES[code];
    if (!def) throw new Error(`${path}:${lineNo}: unknown code "${code}" for ${videoId}`);
    if (seen.has(videoId)) throw new Error(`${path}:${lineNo}: ${videoId} decided twice`);
    seen.add(videoId);

    const note = rest.join(' ').trim();
    out.push(
      JSON.stringify({
        videoId,
        safe: def.safe,
        learnable: def.learnable,
        inScope: def.inScope,
        why: note ? `${def.why} — ${note}` : def.why,
      })
    );
  }

  process.stdout.write(out.join('\n') + '\n');
  process.stderr.write(`${out.length} verdicts\n`);
}

if (require.main === module) main();
