/**
 * The dial has a path to production (regression, 2026-08-19).
 *
 * Measured that day: main had carried dial build 99 since 2026-08-13 and
 * production served 97. The pods were healthy and running the current image;
 * the image contained 97, because nothing had built one.
 *
 * A dial-only commit sets mobile_only=true. Three jobs were written as
 * `mobile_only != 'true'`, which was correct while `fast-mobile` shipped the
 * dial by rsync instead of by image. That job addressed the host released on
 * 2026-08-19 and was removed with it, and the guard outlived its destination:
 * the syntax gate ran, every build and deploy job skipped, and the run was
 * green having shipped nothing.
 *
 * The failure has no symptom. There is no red check, no error, and the site
 * keeps serving — just an older dial than the repository says. That is what
 * makes it worth pinning rather than remembering.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

const DEPLOY = path.join(__dirname, '../../.github/workflows/deploy.yml');

type Job = { if?: string; needs?: string | string[] };
const wf = yaml.load(fs.readFileSync(DEPLOY, 'utf-8')) as {
  jobs: Record<string, Job>;
};
const jobs = wf.jobs;
const cond = (name: string) => jobs[name]?.if ?? '';

describe('a dial-only commit reaches production', () => {
  it('the job that builds the image does not skip on mobile_only', () => {
    // build-and-push is the only thing that puts frontend/public/mobile into a
    // deployable artifact. Narrowing belongs in its per-image step conditions,
    // which already read scope.outputs.frontend.
    expect(jobs['build-and-push']).toBeDefined();
    expect(cond('build-and-push')).not.toMatch(/mobile_only/);
  });

  it('the job that pins the tag is reachable from a dial-only commit', () => {
    // publish-tags needs build-and-push. If that is skipped this is skipped
    // too, and the chart keeps pointing at whatever it pointed at before.
    const needs = ([] as string[]).concat(jobs['publish-tags']?.needs ?? []);
    expect(needs).toContain('build-and-push');
    expect(cond('publish-tags')).not.toMatch(/mobile_only/);
  });

  it('the syntax gate runs whenever the dial changed, not only when it changed alone', () => {
    // Gating on mobile_only meant a commit touching the dial and one other file
    // skipped the only check the dial has: ci.yml does not read this directory
    // at all, since tsc and vitest look at src and vite copies public/ verbatim.
    expect(cond('mobile-gate')).toMatch(/needs\.scope\.outputs\.dial\b/);
    expect(cond('mobile-gate')).not.toMatch(/mobile_only/);
  });

  it('scope publishes the dial signal the gate reads', () => {
    const outputs = (jobs['scope'] as unknown as { outputs?: Record<string, string> }).outputs;
    expect(outputs).toBeDefined();
    expect(Object.keys(outputs!)).toContain('dial');
  });

  it('mobile_only survives only where skipping is narrowing, not a missed deploy', () => {
    // These two are different artifacts a dial edit cannot affect. migrate in
    // particular runs `prisma db push` against production, so running it for a
    // dial edit would be a write with no reason to be there.
    expect(cond('migrate')).toMatch(/mobile_only != 'true'/);
    expect(cond('deploy-edge-functions')).toMatch(/mobile_only != 'true'/);
  });
});
