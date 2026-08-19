/**
 * No workflow writes to main by pushing to it (regression, 2026-08-19).
 *
 * publish-tags ran for the first time on 2026-08-19 and was refused:
 *
 *   remote: error: GH006: Protected branch update failed for refs/heads/main.
 *   remote: - 8 of 8 required status checks are expected.
 *
 * main requires 8 status checks with strict on. A commit CI pushes carries
 * none, so it can never satisfy them, and no setting on the job changes that.
 * rollback.yml wrote by identical means and had not been run since it was
 * rewritten, so the same defect was sitting in the workflow that exists to be
 * used during an incident.
 *
 * Both now push a branch and open a pull request. This pins that: a workflow
 * may push branches, and may not push main.
 */
import * as fs from 'fs';
import * as path from 'path';

const DIR = path.join(__dirname, '../../.github/workflows');
const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.yml'));

/** Lines that run a command, with comments and blank lines removed. */
function commandLines(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));
}

describe('workflows do not push to a protected branch', () => {
  it.each(files)('%s does not push main', (file) => {
    const lines = commandLines(fs.readFileSync(path.join(DIR, file), 'utf-8'));
    // `git push origin main`, `git push origin HEAD:main`, and the refs/heads
    // spelling of either. A push to a branch name that merely contains "main"
    // (mainline/, main-backup) is not matched.
    const pushesMain = lines.filter((l) =>
      /git\s+push\b[^|;&]*\b(origin\s+)?(HEAD:)?(refs\/heads\/)?main\s*$/.test(l)
    );
    expect(pushesMain).toEqual([]);
  });

  it('the two jobs that write image tags open a pull request instead', () => {
    // Naming them explicitly: a rename that drops the mechanism should fail
    // here rather than pass because the file no longer matches a pattern.
    const deploy = fs.readFileSync(path.join(DIR, 'deploy.yml'), 'utf-8');
    const rollback = fs.readFileSync(path.join(DIR, 'rollback.yml'), 'utf-8');
    for (const [name, text] of [
      ['deploy.yml', deploy],
      ['rollback.yml', rollback],
    ] as const) {
      expect(text).toMatch(/gh pr create/);
      // Opening a PR needs this permission; without it the call 403s at the
      // point the tag would have been written.
      expect(text).toMatch(/pull-requests:\s*write/);
      expect(name).toBeTruthy();
    }
  });
});
