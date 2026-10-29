/**
 * The chart only names images that were built (regression, 2026-08-20).
 *
 * build-and-push is selective: each image has its own condition on
 * scope.outputs, so a commit touching src/ builds the api image and nothing
 * else. publish-tags wrote all three tags to github.sha regardless.
 *
 * Measured after #1525, which touched src/ and tests/:
 *
 *   insighta-api:ee911588        present in ECR
 *   insighta-frontend:ee911588   ABSENT
 *   insighta-redis:ee911588      ABSENT
 *
 * charts/insighta/environments/prod.yaml claimed all three. A sync against it
 * would have given ImagePullBackOff on three frontend pods and redis -- an
 * outage produced by a deploy that reported success, with nothing between the
 * two to say so.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

const ROOT = path.join(__dirname, '../..');
const DEPLOY = path.join(ROOT, '.github/workflows/deploy.yml');
const PROD = path.join(ROOT, 'charts/insighta/environments/prod.yaml');

const deploy = fs.readFileSync(DEPLOY, 'utf-8');
const wf = yaml.load(deploy) as {
  jobs: Record<string, { steps?: Array<{ if?: string; name?: string }> }>;
};

describe('publish-tags writes only what build-and-push built', () => {
  it('each image build is conditional on its own scope output', () => {
    // The premise. If these ever become unconditional the whole hazard goes
    // away, and this test should be deleted rather than worked around.
    // Prod images only: the staging frontend build is its own step, checked below.
    const steps = wf.jobs['build-and-push']?.steps ?? [];
    const conds = steps
      .filter((s) => (s.name ?? '').startsWith('Build & push'))
      .filter((s) => !(s.name ?? '').includes('(staging)'))
      .map((s) => s.if ?? '');
    expect(conds).toHaveLength(3);
    expect(conds.join(' ')).toMatch(/scope\.outputs\.api/);
    expect(conds.join(' ')).toMatch(/scope\.outputs\.frontend/);
    expect(conds.join(' ')).toMatch(/scope\.outputs\.redis/);
  });

  it('the staging frontend build runs with the frontend, and never tags latest', () => {
    // A second frontend build exists because the bundle compiles the Supabase
    // URL in. It must follow the same scope output as the prod build, and must
    // not push a tag anything prod-facing could pull.
    type Step = { if?: string; name?: string; with?: { tags?: string } };
    const steps = (wf.jobs['build-and-push']?.steps ?? []) as Step[];
    const stg = steps.filter((s) => (s.name ?? '').includes('(staging)'));
    expect(stg).toHaveLength(1);
    const step: Step = stg[0] ?? {};
    expect(step.if ?? '').toMatch(/scope\.outputs\.frontend/);
    // One tag per line; a tag itself contains spaces (`${{ github.sha }}`).
    const tags = (step.with?.tags ?? '')
      .split('\n')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    expect(tags.length).toBeGreaterThan(0);
    for (const t of tags) {
      expect(t).toMatch(/:stg-\$\{\{ github\.sha \}\}$/);
      expect(t).not.toMatch(/ghcr\.io|:latest/);
    }
  });

  it('staging tags move only for images this run built, chart-only merges included', () => {
    // scope.outputs.api is true for any change outside frontend/, including a
    // chart-only merge that builds nothing. Writing that tag names an image that
    // was never pushed: ImagePullBackOff at the next sync.
    type Step = { id?: string; name?: string; env?: Record<string, string>; run?: string };
    type Job = { if?: string; outputs?: Record<string, string>; steps?: Step[] };
    const job = (wf.jobs as unknown as Record<string, Job>)['publish-staging-tags'];
    expect(job).toBeDefined();

    // Runs for a chart-only change, and tolerates build-and-push being skipped.
    const cond = job?.if ?? '';
    expect(cond).toMatch(/scope\.outputs\.charts/);
    expect(cond).toMatch(/build-and-push\.result == 'skipped'/);
    // A failed build must still stop it.
    expect(cond).not.toMatch(/build-and-push\.result == 'failure'/);

    // The flags come from a step that zeroes them unless the run was deployable.
    const flags = (job?.steps ?? []).find((st) => st.id === 'flags');
    expect(flags).toBeDefined();
    expect(flags?.run ?? '').toMatch(/\$DEPLOYABLE" = "true"/);
    expect(flags?.run ?? '').toMatch(/api=false/);

    // The tag writer and the smoke check read those flags, never scope's raw outputs.
    const writer = (job?.steps ?? []).find((st) =>
      (st.name ?? '').startsWith('Rebuild deploy/staging')
    );
    expect(writer).toBeDefined();
    expect(writer?.env?.['API'] ?? '').toMatch(/steps\.flags\.outputs\.api/);
    expect(writer?.env?.['FE'] ?? '').toMatch(/steps\.flags\.outputs\.frontend/);
    expect(writer?.env?.['RD'] ?? '').toMatch(/steps\.flags\.outputs\.redis/);
    expect(job?.outputs?.['api'] ?? '').toMatch(/steps\.flags\.outputs\.api/);
  });

  it('the staging Edge Function deploy bundles server-side, not in docker', () => {
    // The docker bundling pulls an image from a registry that rate-limits shared
    // runners: "Data limit exceeded", first staging run 2026-10-29.
    type Step = { name?: string; run?: string };
    const job = (wf.jobs as unknown as Record<string, { steps?: Step[] }>)[
      'deploy-edge-functions-staging'
    ];
    expect(job).toBeDefined();
    const deploy = (job?.steps ?? []).find((st) =>
      (st.run ?? '').includes('supabase functions deploy')
    );
    expect(deploy?.run ?? '').toMatch(/--use-api/);
  });

  it('the staging smoke check still runs when build-and-push was skipped', () => {
    // Without a status function GitHub also requires every ancestor job to have
    // run. A chart-only merge skips build-and-push, and the check was skipped
    // with it (observed 2026-10-29, run 40824883266).
    const job = (wf.jobs as unknown as Record<string, { if?: string }>)['smoke-staging'];
    expect(job).toBeDefined();
    expect(job?.if ?? '').toMatch(/^always\(\)/);
    expect(job?.if ?? '').toMatch(/publish-staging-tags\.result == 'success'/);
  });

  it('the staging E2E runs after the smoke check, through the reusable workflow', () => {
    type Job = { if?: string; needs?: string | string[]; uses?: string };
    const job = (wf.jobs as unknown as Record<string, Job>)['e2e-staging'];
    expect(job).toBeDefined();
    expect(job?.uses).toBe('./.github/workflows/e2e-staging.yml');
    expect(job?.needs).toEqual(['smoke-staging']);
    expect(job?.if ?? '').toMatch(/^always\(\)/);
    expect(job?.if ?? '').toMatch(/smoke-staging\.result == 'success'/);
  });

  it('the staging E2E workflow targets staging and has no other host to fall back to', () => {
    type Step = { run?: string; env?: Record<string, string> };
    const e2e = yaml.load(
      fs.readFileSync(path.join(ROOT, '.github/workflows/e2e-staging.yml'), 'utf-8')
    ) as { on: Record<string, unknown>; jobs: Record<string, { steps?: Step[] }> };
    expect(Object.keys(e2e.on)).toEqual(
      expect.arrayContaining(['workflow_call', 'workflow_dispatch'])
    );
    const run = (e2e.jobs['e2e-staging']?.steps ?? []).find((st) =>
      (st.run ?? '').includes('playwright test')
    );
    expect(run?.run ?? '').toMatch(/playwright\.stg\.config\.ts/);
    expect(run?.env?.['BASE_URL']).toBe('https://stg.insighta.one');
  });

  it('the tag loop reads the same three outputs', () => {
    // The defect was `for key in apiTag frontendTag redisTag` with no reference
    // to what was built. Pinning the pairing, not the syntax.
    const loop = deploy.slice(deploy.indexOf('publish-tags:'));
    for (const out of ['api', 'frontend', 'redis']) {
      expect(loop).toMatch(new RegExp(`needs\\.scope\\.outputs\\.${out}\\b`));
    }
  });

  it('no tag is advanced unconditionally', () => {
    const loop = deploy.slice(deploy.indexOf('publish-tags:'));
    expect(loop).not.toMatch(/for key in apiTag frontendTag redisTag/);
  });

  it('prod.yaml pins a concrete sha for every image', () => {
    // `latest` is what pinning replaced: two revisions naming one string, and
    // IfNotPresent letting nodes diverge under it.
    const prod = yaml.load(fs.readFileSync(PROD, 'utf-8')) as {
      images?: Record<string, string>;
    };
    const images = prod.images ?? {};
    for (const key of ['apiTag', 'frontendTag', 'redisTag']) {
      expect(images[key]).toBeDefined();
      expect(images[key]).not.toBe('latest');
      expect(images[key]).toMatch(/^[0-9a-f]{40}$/);
    }
  });
});
