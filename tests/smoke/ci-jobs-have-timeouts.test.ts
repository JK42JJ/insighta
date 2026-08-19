/**
 * Every CI job has a timeout (regression, 2026-08-19).
 *
 * `npx playwright install --with-deps chromium` stopped returning that day.
 * With no timeout anywhere in ci.yml, the job ran toward GitHub's 6-hour
 * default, and three pull requests sat blocked for five hours on a required
 * check that was neither passing nor failing.
 *
 * That is the worst of the three states. A failure reports and can be re-run;
 * a pass merges. A check that never reports blocks the branch and produces no
 * signal to act on, and the only clue was that every run started after 05:06Z
 * hung while every run before it passed in two to five minutes.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

const CI = path.join(__dirname, '../../.github/workflows/ci.yml');
const wf = yaml.load(fs.readFileSync(CI, 'utf-8')) as {
  jobs: Record<string, { 'timeout-minutes'?: number }>;
};

describe('ci.yml jobs are bounded in time', () => {
  const entries = Object.entries(wf.jobs);

  it('has jobs to check', () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it.each(entries)('%s declares timeout-minutes', (_name, job) => {
    expect(job['timeout-minutes']).toBeDefined();
  });

  it.each(entries)('%s timeout is short enough to be a signal', (_name, job) => {
    // Measured over the last four successful runs on 2026-08-19: the slowest
    // job took 16.4 minutes and the rest took under 3. A timeout above 30
    // stops being an alarm and becomes another way to wait.
    const t = job['timeout-minutes'];
    expect(t).toBeGreaterThan(0);
    expect(t).toBeLessThanOrEqual(30);
  });
});
