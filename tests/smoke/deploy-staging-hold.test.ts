/**
 * Staging hold (2026-11-12): while STAGING_HOLD_BRANCH is set, a main merge must not touch staging.
 * main's Prisma schema lacks the held branch's tables, and the staging schema sync would drop them.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

const DEPLOY = path.join(__dirname, '../../.github/workflows/deploy.yml');
const wf = yaml.load(fs.readFileSync(DEPLOY, 'utf-8')) as {
  jobs: Record<string, { if?: string | boolean }>;
};
const cond = (job: string): string => String(wf.jobs[job]?.if ?? '');

const STAGING_JOBS = ['migrate-staging', 'deploy-edge-functions-staging', 'publish-staging-tags'];
const MAIN_UNLESS_HELD = "(github.ref == 'refs/heads/main' && vars.STAGING_HOLD_BRANCH == '')";

describe('staging hold', () => {
  it.each(STAGING_JOBS)('%s runs for main only when no branch holds staging', (job) => {
    expect(cond(job)).toContain(MAIN_UNLESS_HELD);
  });

  it.each(STAGING_JOBS)('%s never names main without the hold check', (job) => {
    const bare = cond(job).split(MAIN_UNLESS_HELD).join('');
    expect(bare).not.toContain("github.ref == 'refs/heads/main'");
  });

  it('prod jobs do not read the hold variable', () => {
    for (const job of ['deploy-edge-functions', 'migrate', 'publish-tags', 'build-and-push']) {
      expect(cond(job)).not.toContain('STAGING_HOLD_BRANCH');
    }
  });
});
