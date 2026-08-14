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
