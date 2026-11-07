/**
 * Agent branch runs push to the staging repositories only (2026-11-07).
 *
 * The first staging_only run from an agent branch stopped at the AWS login because the CI role is not trusted for agent/* branches. The fix gives branch
 * runs a narrow role that can push to insighta-stg-api and insighta-stg-frontend and nothing else. This pins the workflow side (what a branch run may push),
 * the tag writer (tag and repository move together) and the terraform side (what the role may do).
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import * as yaml from 'js-yaml';

const ROOT = path.join(__dirname, '../..');
const DEPLOY = path.join(ROOT, '.github/workflows/deploy.yml');
const WRITER = path.join(ROOT, 'scripts/ci/write-staging-tags.sh');
const TF = path.join(ROOT, 'terraform/global/iam-ci/stg-build.tf');

type Step = { name?: string; if?: string; with?: Record<string, string> };
type Job = { if?: string | boolean; steps?: Step[] };
const wf = yaml.load(fs.readFileSync(DEPLOY, 'utf-8')) as { jobs: Record<string, Job> };
const steps = (wf.jobs['build-and-push']?.steps ?? []) as Step[];
const AGENT = "startsWith(github.ref, 'refs/heads/agent/')";
const byName = (prefix: string): Step => {
  const s = steps.find((st) => (st.name ?? '').startsWith(prefix));
  if (!s) throw new Error(`no step named ${prefix}`);
  return s;
};

describe('workflow: what an agent branch run may push', () => {
  it('the build job runs on an agent branch only for staging_only', () => {
    const c = String(wf.jobs['build-and-push']?.if ?? '');
    expect(c).toContain(`(!${AGENT} || inputs.staging_only)`);
  });

  it('prod schema sync never runs from an agent branch', () => {
    expect(String(wf.jobs['migrate']?.if ?? '')).toContain(`!${AGENT}`);
  });

  it('the AWS role is the narrow one on agent branches, the CI role otherwise', () => {
    const role = String(byName('Configure AWS credentials').with?.['role-to-assume'] ?? '');
    expect(role).toContain(AGENT);
    expect(role).toContain('secrets.AWS_STG_BUILD_ROLE_ARN');
    expect(role).toMatch(/\|\| secrets\.AWS_ROLE_ARN/);
  });

  it.each([
    'Build & push API image (agent branch',
    'Build & push Frontend image (staging, agent branch',
  ])('%s pushes to a staging repository only: no latest, no GHCR, no prod repository', (name) => {
    const st = byName(name);
    expect(st.if).toContain(AGENT);
    const tags = String(st.with?.['tags'] ?? '');
    expect(tags).toMatch(/insighta-stg-(api|frontend):\$\{\{ github\.sha \}\}/);
    expect(tags).not.toContain('latest');
    expect(tags).not.toContain('ghcr');
    expect(tags).not.toMatch(/\/insighta-(api|frontend|redis):/);
  });

  it.each([
    'Build & push API image',
    'Build & push Frontend image (staging)',
    'Build & push Redis image',
  ])('the regular step "%s" is skipped on an agent branch', (name) => {
    const st = steps.find((s) => s.name === name);
    expect(st).toBeDefined();
    expect(String(st?.if ?? '')).toContain(`!${AGENT}`);
  });

  it('the prod frontend image is never built for staging_only', () => {
    expect(String(byName('Build & push Frontend image').if ?? '')).toContain(
      '!inputs.staging_only'
    );
  });
});

describe('write-staging-tags.sh: tag and repository move together', () => {
  const A = 'a'.repeat(40);
  const B = 'b'.repeat(40);
  const SEED = `images:\n  apiTag: ${'c'.repeat(40)}\n  frontendTag: none\n  redisTag: ${'d'.repeat(
    40
  )}\nfrontend:\n  replicaCount: 0\n`;
  const run = (
    file: string,
    sha: string,
    api: boolean,
    fe: boolean,
    rd: boolean,
    agent?: boolean
  ): void => {
    execFileSync('bash', [
      WRITER,
      file,
      sha,
      String(api),
      String(fe),
      String(rd),
      ...(agent === undefined ? [] : [String(agent)]),
    ]);
  };
  const tmp = (): string => {
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'stgtags-')), 'staging-images.yaml');
    fs.writeFileSync(f, SEED);
    return f;
  };

  it('an agent run points api and frontend at the staging repositories and uses the plain commit tag', () => {
    const f = tmp();
    run(f, A, true, true, false, true);
    const v = yaml.load(fs.readFileSync(f, 'utf-8')) as Record<string, any>;
    expect(v['images'].apiTag).toBe(A);
    expect(v['images'].frontendTag).toBe(A);
    expect(v['api'].image.repository).toBe('insighta-stg-api');
    expect(v['frontend'].image.repository).toBe('insighta-stg-frontend');
    expect(v['frontend']?.replicaCount).toBeUndefined();
  });

  it('a later main run that builds the api goes back to the shared repository and leaves the frontend pair alone', () => {
    const f = tmp();
    run(f, A, true, true, false, true);
    run(f, B, true, false, false, false);
    const v = yaml.load(fs.readFileSync(f, 'utf-8')) as Record<string, any>;
    expect(v['images'].apiTag).toBe(B);
    expect(v['api']).toBeUndefined();
    expect(v['images'].frontendTag).toBe(A);
    expect(v['frontend'].image.repository).toBe('insighta-stg-frontend');
  });

  it('a main run behaves as before: stg- prefixed frontend tag, no repository override', () => {
    const f = tmp();
    run(f, B, true, true, true);
    const v = yaml.load(fs.readFileSync(f, 'utf-8')) as Record<string, any>;
    expect(v['images'].frontendTag).toBe(`stg-${B}`);
    expect(v['images'].redisTag).toBe(B);
    expect(v['api']).toBeUndefined();
    expect(v['frontend']).toBeUndefined();
  });

  it('an agent run that builds nothing moves nothing', () => {
    const f = tmp();
    run(f, A, false, false, false, true);
    expect(fs.readFileSync(f, 'utf-8')).toBe(SEED);
  });
});

describe('terraform: the staging build role', () => {
  const tf = fs.readFileSync(TF, 'utf-8');

  it('is trusted only for agent/* branches of this repository', () => {
    expect(tf).toContain('values   = ["repo:JK42JJ/insighta:ref:refs/heads/agent/*"]');
    expect(tf.match(/repo:JK42JJ\/insighta:/g)).toHaveLength(1);
  });

  it('can push to the two staging repositories and does nothing else', () => {
    const policy = tf.slice(
      tf.indexOf('resource "aws_iam_policy" "stg_ecr_push"'),
      tf.indexOf('data "aws_iam_policy_document"')
    );
    const actions = Array.from(policy.matchAll(/"([a-z0-9-]+:[A-Za-z*]+)"/g)).map((m) => m[1]);
    expect(actions.sort()).toEqual(
      [
        'ecr:BatchCheckLayerAvailability',
        'ecr:BatchGetImage',
        'ecr:CompleteLayerUpload',
        'ecr:GetAuthorizationToken',
        'ecr:GetDownloadUrlForLayer',
        'ecr:InitiateLayerUpload',
        'ecr:PutImage',
        'ecr:UploadLayerPart',
      ].sort()
    );
    expect(policy).toContain('aws_ecr_repository.stg');
    expect(policy).not.toMatch(
      /iam:|ec2:|DeleteRepository|CreateRepository|SetRepositoryPolicy|PutImageTagMutability|BatchDeleteImage/
    );
  });

  it('only creates the two staging repositories', () => {
    expect(tf).toContain('stg_repositories = ["insighta-stg-api", "insighta-stg-frontend"]');
  });
});
