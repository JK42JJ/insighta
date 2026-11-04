/**
 * promote.yml gates a production promotion on scripts/ci/promote-gate.sh.
 *
 * The gate must fail closed. A docs-only or chart-only merge skips every
 * staging job, and deploy.yml still ends green (observed 2026-11-04, runs
 * 41828376717 and 41826986229). A gate that read "the run did not fail" would
 * have passed those commits having proved nothing. So: skipped, cancelled, in
 * progress and absent are all failures, and only `success` on both staging
 * checks passes.
 *
 * The script is run for real against a throwaway git repository, with `gh`
 * replaced by a stub that serves canned REST responses. The workflow file is
 * parsed and its safety properties pinned: no input that bypasses the gate, no
 * secrets, no inline expressions in `run:`, stubs that only echo.
 */

import { spawnSync } from 'child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import * as yaml from 'js-yaml';

const ROOT = join(__dirname, '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'ci', 'promote-gate.sh');
const WORKFLOW = join(ROOT, '.github', 'workflows', 'promote.yml');

const SMOKE = 'Staging smoke check';
const E2E = 'Staging E2E / Playwright E2E (staging)';
const RUN_ID = 4242;

interface Job {
  name: string;
  status: string;
  conclusion: string | null;
}
interface Run {
  id: number;
  status: string;
  conclusion: string | null;
  created_at: string;
  event: string;
}

const done = (name: string, conclusion: string | null): Job => ({
  name,
  status: conclusion ? 'completed' : 'in_progress',
  conclusion,
});
const completedRun = (id: number, created: string): Run => ({
  id,
  status: 'completed',
  conclusion: 'success',
  created_at: created,
  event: 'push',
});

let dir: string;
let repo: string;
let onMain: string;
let offMain: string;

function git(args: string[], cwd = repo): string {
  const r = spawnSync('git', args, { cwd, encoding: 'utf-8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'promote-gate-'));
  repo = join(dir, 'repo');
  spawnSync('mkdir', ['-p', repo]);
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 't@example.com']);
  git(['config', 'user.name', 't']);
  git(['config', 'commit.gpgsign', 'false']);
  writeFileSync(join(repo, 'a'), '1');
  git(['add', 'a']);
  git(['commit', '-q', '-m', 'a']);
  git(['checkout', '-q', '-b', 'side']);
  writeFileSync(join(repo, 'c'), '3');
  git(['add', 'c']);
  git(['commit', '-q', '-m', 'c']);
  offMain = git(['rev-parse', 'HEAD']);
  git(['checkout', '-q', 'main']);
  writeFileSync(join(repo, 'b'), '2');
  git(['add', 'b']);
  git(['commit', '-q', '-m', 'b']);
  onMain = git(['rev-parse', 'HEAD']);

  // gh stub: serves the two REST calls the script makes and records the paths.
  const bin = join(dir, 'bin');
  spawnSync('mkdir', ['-p', bin]);
  writeFileSync(
    join(bin, 'gh'),
    `#!/usr/bin/env bash
echo "$*" >> "${dir}/gh-calls"
[ "$1" = "api" ] || exit 9
case "$2" in
  *"/actions/workflows/deploy.yml/runs?"*) [ -f "${dir}/runs.json" ] && cat "${dir}/runs.json" || exit 1 ;;
  *"/actions/runs/"*"/jobs?"*)              [ -f "${dir}/jobs.json" ] && cat "${dir}/jobs.json" || exit 1 ;;
  *) exit 9 ;;
esac
`
  );
  chmodSync(join(bin, 'gh'), 0o755);
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

beforeEach(() => {
  for (const f of ['runs.json', 'jobs.json', 'gh-calls', 'summary.md']) {
    rmSync(join(dir, f), { force: true });
  }
});

function serve(runs: Run[] | null, jobs: Job[] | null) {
  if (runs) writeFileSync(join(dir, 'runs.json'), JSON.stringify({ workflow_runs: runs }));
  if (jobs) writeFileSync(join(dir, 'jobs.json'), JSON.stringify({ jobs }));
}

function gate(sha: string) {
  const r = spawnSync('bash', [SCRIPT, sha], {
    cwd: repo,
    encoding: 'utf-8',
    env: {
      ...process.env,
      PATH: `${join(dir, 'bin')}:${process.env.PATH}`,
      GATE_MAIN_REF: 'main',
      GATE_REPO: 'owner/name',
      GITHUB_STEP_SUMMARY: join(dir, 'summary.md'),
    },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

const green = [done(SMOKE, 'success'), done(E2E, 'success')];

describe('promote-gate.sh', () => {
  it('passes when both staging checks succeeded', () => {
    serve([completedRun(RUN_ID, '2026-11-03T17:27:52Z')], green);
    const r = gate(onMain);
    expect(r.code).toBe(0);
    expect(r.out).toContain('PASS');
    expect(readFileSync(join(dir, 'summary.md'), 'utf-8')).toContain('Promote gate: passed');
  });

  it('asks for push runs of exactly this commit', () => {
    serve([completedRun(RUN_ID, '2026-11-03T17:27:52Z')], green);
    gate(onMain);
    const calls = readFileSync(join(dir, 'gh-calls'), 'utf-8');
    expect(calls).toContain(`head_sha=${onMain}&event=push`);
    expect(calls).toContain(`/actions/runs/${RUN_ID}/jobs?filter=latest`);
  });

  it.each([
    ['E2E skipped (docs-only merge)', [done(SMOKE, 'skipped'), done('Staging E2E', 'skipped')]],
    ['smoke skipped', [done(SMOKE, 'skipped'), done(E2E, 'success')]],
    ['E2E failed', [done(SMOKE, 'success'), done(E2E, 'failure')]],
    ['E2E cancelled', [done(SMOKE, 'success'), done(E2E, 'cancelled')]],
    ['E2E still running', [done(SMOKE, 'success'), done(E2E, null)]],
    ['E2E job absent', [done(SMOKE, 'success')]],
    ['smoke job absent', [done(E2E, 'success')]],
    ['no staging jobs at all', [done('Detect scope', 'success')]],
    [
      'duplicate E2E job, one skipped',
      [done(SMOKE, 'success'), done(E2E, 'success'), done(E2E, 'skipped')],
    ],
  ])('fails closed: %s', (_label, jobs) => {
    serve([completedRun(RUN_ID, '2026-11-03T17:27:52Z')], jobs as Job[]);
    const r = gate(onMain);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/^promote-gate: .+/m);
    expect(readFileSync(join(dir, 'summary.md'), 'utf-8')).toContain('FAILED');
  });

  it('fails when deploy.yml has no push run for the commit', () => {
    serve([], null);
    const r = gate(onMain);
    expect(r.code).toBe(1);
    expect(r.out).toContain('no deploy.yml push run');
  });

  it('fails when the run has not completed', () => {
    serve([{ ...completedRun(RUN_ID, '2026-11-03T17:27:52Z'), status: 'in_progress' }], green);
    const r = gate(onMain);
    expect(r.code).toBe(1);
    expect(r.out).toContain('in_progress');
  });

  it('judges the newest run, so a later red re-run cannot hide behind an older green one', () => {
    serve(
      [completedRun(1, '2026-11-03T10:00:00Z'), completedRun(2, '2026-11-03T12:00:00Z')],
      [done(SMOKE, 'success'), done(E2E, 'failure')]
    );
    const r = gate(onMain);
    expect(r.code).toBe(1);
    expect(readFileSync(join(dir, 'gh-calls'), 'utf-8')).toContain('/actions/runs/2/jobs');
  });

  it('fails when the API call itself fails', () => {
    // No fixtures served: the stub exits 1 for both endpoints.
    const r = gate(onMain);
    expect(r.code).toBe(1);
  });

  it.each([
    ['not hex', 'zzzz'],
    ['too short', onMainPrefix()],
    ['empty', ''],
    ['uppercase', 'A'.repeat(40)],
    ['option-shaped', '--help'],
  ])('rejects a malformed sha (%s) with exit 2 before calling gh', (_label, sha) => {
    const r = gate(sha);
    expect(r.code).toBe(2);
    expect(existsSync(join(dir, 'gh-calls'))).toBe(false);
  });

  it('fails for a commit that is not an ancestor of main', () => {
    serve([completedRun(RUN_ID, '2026-11-03T17:27:52Z')], green);
    const r = gate(offMain);
    expect(r.code).toBe(1);
    expect(r.out).toContain('not an ancestor');
    expect(existsSync(join(dir, 'gh-calls'))).toBe(false);
  });

  it('fails for a well-formed sha that is not in the checkout', () => {
    const r = gate('0'.repeat(40));
    expect(r.code).toBe(1);
    expect(r.out).toContain('not in this checkout');
  });
});

function onMainPrefix(): string {
  return 'abc123';
}

// ---------------------------------------------------------------------------
// Workflow file: the properties that keep the skeleton harmless.
// ---------------------------------------------------------------------------

interface Step {
  run?: string;
  uses?: string;
  env?: Record<string, string>;
}
interface WfJob {
  needs?: string[];
  if?: string;
  environment?: string;
  'timeout-minutes'?: number;
  steps: Step[];
}
const text = readFileSync(WORKFLOW, 'utf-8');
const wf = yaml.load(text) as {
  on: { workflow_dispatch: { inputs: Record<string, unknown> } } & Record<string, unknown>;
  permissions: Record<string, string>;
  concurrency: { group: string; 'cancel-in-progress': boolean };
  jobs: Record<string, WfJob>;
};

describe('promote.yml', () => {
  it('is dispatched by hand only', () => {
    expect(Object.keys(wf.on)).toEqual(['workflow_dispatch']);
  });

  it('has exactly sha, reason and components as inputs: nothing skips the gate', () => {
    expect(Object.keys(wf.on.workflow_dispatch.inputs).sort()).toEqual([
      'components',
      'reason',
      'sha',
    ]);
  });

  it('reads the repository and actions, nothing more', () => {
    expect(wf.permissions).toEqual({ contents: 'read', actions: 'read' });
  });

  it('has its own concurrency group and never cancels a waiting approval', () => {
    expect(wf.concurrency.group).toBe('promote');
    expect(wf.concurrency.group).not.toBe('deploy-production');
    expect(wf.concurrency['cancel-in-progress']).toBe(false);
  });

  it('references no secrets and no cloud or cluster tooling', () => {
    expect(text).not.toMatch(/secrets\./);
    expect(text).not.toMatch(/aws-actions|kubectl|supabase|terraform|docker\/login/i);
  });

  it('keeps every expression out of run: bodies', () => {
    for (const [name, job] of Object.entries(wf.jobs)) {
      for (const step of job.steps) {
        if (step.run) expect([name, step.run]).not.toEqual([name, expect.stringContaining('${{')]);
      }
    }
  });

  it.each(Object.entries(wf.jobs))('%s has a short timeout', (_name, job) => {
    expect(job['timeout-minutes']).toBeGreaterThan(0);
    expect(job['timeout-minutes']).toBeLessThanOrEqual(30);
  });

  it('runs the gate only from main, then waits on the Production environment', () => {
    expect(wf.jobs.gate.if).toBe("github.ref == 'refs/heads/main'");
    expect(wf.jobs.approve.needs).toEqual(['gate']);
    expect(wf.jobs.approve.environment).toBe('Production');
  });

  it.each(['migrate', 'edge', 'pin-images'])('%s is an approval-gated echo stub', (name) => {
    const job = wf.jobs[name];
    expect(job.needs).toEqual(['approve']);
    expect(job.environment).toBeUndefined();
    expect(job.steps).toHaveLength(1);
    expect(job.steps[0].uses).toBeUndefined();
    expect(job.steps[0].run).toMatch(/^echo "STUB: would /);
  });
});
