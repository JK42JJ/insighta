/**
 * The stage array, checked against the ledger's list and against the directory.
 *
 * Two different guards, and only the second one would have caught R4.
 *
 * R4 wrote `s8-evidence.ts`, gave it `id: 'S6_stats'` -- the real S6's id --
 * and never added it to STAGES or to PIPELINE_STAGES. Checking those two lists
 * against each other says nothing about that: a stage absent from both leaves
 * them agreeing perfectly. Measured, not assumed -- the four list checks below
 * pass unchanged against the pre-R5 tree.
 *
 * What catches it is asking the directory. A file in `stages/` that no list
 * mentions is a stage nobody runs, and code that does not run cannot fail:
 * S8 compiled, had ten passing tests of its own, and sat dead for four days
 * while the loop recorded T4 as unmeasurable.
 */

import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { STAGES } from '@/modules/newsletter/pipeline';
import { PIPELINE_STAGES } from '@/modules/newsletter/pipeline-ledger';

describe('STAGES', () => {
  it('gives every stage its own id', () => {
    // `newsletter_pipeline_steps` is unique on (run_id, stage). Two stages
    // sharing an id means the second one's ledger row is refused mid-run, and
    // the run that discovers it is a production run.
    const ids = STAGES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('uses only ids the ledger knows', () => {
    for (const s of STAGES) expect(PIPELINE_STAGES).toContain(s.id);
  });

  it('runs them in the order the ledger declares', () => {
    // `--from`/`--to` slice this array and the ledger's order is what a reader
    // of the run reconstructs from. Two orders is one too many.
    const declared = PIPELINE_STAGES.filter((id) => STAGES.some((s) => s.id === id));
    expect(STAGES.map((s) => s.id)).toEqual(declared);
  });

  it('runs every stage the ledger declares', () => {
    // The omission half. A stage can exist, compile, have tests, and never
    // run -- which is exactly what happened to S8.
    expect(STAGES.map((s) => s.id).sort()).toEqual([...PIPELINE_STAGES].sort());
  });
});

describe('the stages directory', () => {
  const dir = join(__dirname, '../../../../src/modules/newsletter/pipeline/stages');
  const files = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));

  it('has a file for every stage and a stage for every file', () => {
    // The check R4 needed. `s8-evidence.ts` existed, compiled, and ran nowhere;
    // no list disagreed with another because it was in neither of them. The
    // directory is the only place that knows the file is there.
    //
    // Mapping is by ordinal: s3-judge.ts -> S3_judge. A stage that does not
    // follow it has to say so here, which is the point -- the naming is what
    // makes the omission visible.
    const fromFiles = files
      .map((f) => /^s(\d+)-/.exec(f)?.[1])
      .filter((n): n is string => n !== undefined)
      .map((n) => Number(n))
      .sort((a, b) => a - b);
    const fromStages = PIPELINE_STAGES.map((id) => Number(/^S(\d+)_/.exec(id)?.[1] ?? -1)).sort(
      (a, b) => a - b
    );

    expect(fromFiles).toEqual(fromStages);
  });

  it('names every file after the stage it declares', () => {
    // `s8-evidence.ts` declaring `id: 'S6_stats'` is only visible from here:
    // from inside the file the string is plausible, and from the array the
    // file is invisible.
    for (const f of files) {
      const ordinal = /^s(\d+)-/.exec(f)?.[1];
      if (ordinal === undefined) continue;
      const id = PIPELINE_STAGES.find((s2) => s2.startsWith(`S${ordinal}_`));
      expect(id).toBeDefined();
      const stage = STAGES.find((s2) => s2.id === id);
      expect(stage).toBeDefined();
    }
  });
});
