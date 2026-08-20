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
    const steps = wf.jobs['build-and-push']?.steps ?? [];
    const conds = steps
      .filter((s) => (s.name ?? '').startsWith('Build & push'))
      .map((s) => s.if ?? '');
    expect(conds).toHaveLength(3);
    expect(conds.join(' ')).toMatch(/scope\.outputs\.api/);
    expect(conds.join(' ')).toMatch(/scope\.outputs\.frontend/);
    expect(conds.join(' ')).toMatch(/scope\.outputs\.redis/);
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
