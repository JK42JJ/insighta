/**
 * A draft change can reach staging before it is merged; nothing else changes (2026-11-07).
 *
 * The three staging jobs run for a push to main and also for a manual run with
 * staging_only=true from an agent/* branch. Every job that writes to prod keeps
 * its own condition, and none of them can run from a branch.
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
const AGENT_BRANCH = "inputs.staging_only && startsWith(github.ref, 'refs/heads/agent/')";

describe('staging from an agent branch, prod untouched', () => {
  it.each(STAGING_JOBS)('%s runs on main or on a staging_only run from agent/*', (job) => {
    const c = cond(job);
    expect(c).toContain("github.ref == 'refs/heads/main'");
    expect(c).toContain(AGENT_BRANCH);
    expect(c).toContain("vars.STG_PROJECT_REF != ''");
  });

  it.each(['deploy-edge-functions', 'migrate', 'publish-tags'])(
    'prod job %s never runs for staging_only',
    (job) => {
      const c = cond(job);
      expect(c).toContain('!inputs.staging_only');
      // No prod job runs FROM an agent branch: at most it names the branch to exclude it.
      expect(c.replace("!startsWith(github.ref, 'refs/heads/agent/')", '')).not.toContain('agent/');
    }
  );

  it('the prod jobs that write to the repo or the cluster stay tied to main', () => {
    for (const job of ['deploy-edge-functions', 'publish-tags']) {
      expect(cond(job)).toContain("github.ref == 'refs/heads/main'");
    }
  });

  it('only the staging jobs allow agent/*; the build job and prod schema sync mention it to restrict it', () => {
    const allowed = [...STAGING_JOBS, 'build-and-push', 'migrate'];
    const others = Object.keys(wf.jobs).filter(
      (j) => !allowed.includes(j) && cond(j).includes('agent/')
    );
    expect(others).toEqual([]);
    expect(cond('build-and-push')).toContain('inputs.staging_only');
  });
});
