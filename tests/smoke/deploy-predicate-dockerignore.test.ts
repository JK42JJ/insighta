import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * The deploy predicate in .github/workflows/deploy.yml skips deployment when
 * every changed path is "irrelevant". Its comment justifies each entry by
 * asserting the path cannot reach production — chiefly because .dockerignore
 * keeps it out of the API image.
 *
 * Nothing enforced that. A directory added to the predicate but not to
 * .dockerignore would ship inside the image while the workflow claimed it
 * could not, and the first symptom would be a change that silently failed to
 * deploy. These tests make the claim fail loudly instead.
 */

const ROOT = join(__dirname, '..', '..');

function irrelevantDirs(): string[] {
  const wf = readFileSync(join(ROOT, '.github/workflows/deploy.yml'), 'utf8');
  const line = wf.split('\n').find((l) => l.includes('IRRELEVANT='));
  if (!line) throw new Error('IRRELEVANT= not found in deploy.yml');

  // IRRELEVANT='^(a|b|c)/|^[^/]*\.md$'  ->  ['a', 'b', 'c']
  const group = line.match(/\^\(([^)]+)\)\//)?.[1];
  if (!group) throw new Error(`could not parse directory group from: ${line.trim()}`);
  return group.split('|').map((d) => d.replace(/\\/g, ''));
}

function dockerignoreEntries(): string[] {
  return readFileSync(join(ROOT, '.dockerignore'), 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

describe('deploy predicate vs .dockerignore', () => {
  it('parses a non-empty directory list out of the predicate', () => {
    expect(irrelevantDirs().length).toBeGreaterThan(0);
  });

  it('every directory the predicate calls irrelevant is excluded from the image', () => {
    const ignored = new Set(dockerignoreEntries());
    const shipped = irrelevantDirs().filter((d) => !ignored.has(d));

    expect(shipped).toEqual([]);
  });

  // Negative control: the assertion above must be capable of failing.
  // Without this, a parser that silently returns [] would pass forever.
  it('flags a directory that is in the predicate but not in .dockerignore', () => {
    const ignored = new Set(dockerignoreEntries());
    const pretend = [...irrelevantDirs(), 'not-in-dockerignore'];

    expect(pretend.filter((d) => !ignored.has(d))).toEqual(['not-in-dockerignore']);
  });
});

/**
 * The directory list above is only half the predicate. The other half decides
 * top-level files, and it read `^[^/]*\.md$` alone -- so a .gitignore edit was
 * a deployable change.
 *
 * That is not theoretical: PR #1497 changed .gitignore, scripts/ and tests/,
 * and rebuilt and redeployed production at 06:01:47Z on 2026-08-14. Nothing in
 * it could reach the running application.
 *
 * The fix names files individually rather than matching dotfiles as a class,
 * because .dockerignore is a dotfile and decides what the image contains --
 * the opposite of irrelevant. These cases pin both directions.
 */
describe('deploy predicate: which paths trigger a deploy', () => {
  function predicate(): RegExp {
    const wf = readFileSync(join(ROOT, '.github/workflows/deploy.yml'), 'utf8');
    const line = wf.split('\n').find((l) => l.includes('IRRELEVANT='));
    if (!line) throw new Error('IRRELEVANT= not found in deploy.yml');
    const body = line.split("'")[1];
    if (!body) throw new Error(`could not extract the pattern from: ${line.trim()}`);
    return new RegExp(body);
  }

  // true  = a change to this path must rebuild and redeploy
  // false = it provably cannot alter what runs, so it must not
  const CASES: Array<[string, boolean]> = [
    ['src/api/server.ts', true],
    ['frontend/src/App.tsx', true],
    ['package.json', true],
    ['docker/redis/Dockerfile', true],
    // Decides what goes into the image. A dotfile, and the opposite of irrelevant.
    ['.dockerignore', true],

    ['.gitignore', false],
    ['.gitattributes', false],
    ['.editorconfig', false],
    ['LICENSE', false],
    ['README.md', false],
    ['scripts/ops/ssh.sh', false],
    ['tests/smoke/x.test.ts', false],
    ['charts/insighta/values.yaml', false],
    ['terraform/main.tf', false],
    ['.github/workflows/ci.yml', false],
  ];

  it.each(CASES)('%s -> deploys=%s', (path, shouldDeploy) => {
    expect(!predicate().test(path)).toBe(shouldDeploy);
  });

  // Negative control: a path nobody classified must fall through to deploying.
  // An allowlist would silently skip it, and a deploy that should have happened
  // and did not is the failure this repository can least afford.
  it('an unknown top-level directory still deploys', () => {
    expect(predicate().test('some-new-thing/file.ts')).toBe(false);
  });
});
