import { execFileSync } from 'child_process';
import { resolve, dirname, relative, isAbsolute } from 'path';

/**
 * No tracked symlink may point outside the repository.
 *
 * ArgoCD's repo-server refuses an entire repository containing one --
 * "repository contains out-of-bounds symlinks" -- so a single such entry
 * stops every Application sourced from this repo from comparing state at
 * all. It is a repo-wide outage, not a per-file problem.
 *
 * One was committed here: `node_modules` as a symlink to an absolute path,
 * a natural by-product of sharing dependencies across git worktrees.
 * .gitignore listed only `node_modules/`, and a trailing slash restricts a
 * pattern to directories, which git does not consider a symlink to be. It
 * was therefore never ignored, and returned on the next `git add -A` after
 * each attempt to untrack it.
 *
 * Fixing the pattern only covers that one name. This covers the rule.
 */

const ROOT = resolve(__dirname, '..', '..');

interface TrackedLink {
  path: string;
  target: string;
}

function trackedSymlinks(): TrackedLink[] {
  // Mode 120000 is git's file mode for a symlink; the blob holds the target.
  const out = execFileSync('git', ['ls-files', '-s'], { cwd: ROOT, encoding: 'utf8' });
  return out
    .split('\n')
    .filter((l) => l.startsWith('120000 '))
    .flatMap((l) => {
      const [meta, path] = l.split('\t');
      const sha = meta?.split(/\s+/)[1];
      if (!meta || !path || !sha) return [];
      const target = execFileSync('git', ['cat-file', '-p', sha], {
        cwd: ROOT,
        encoding: 'utf8',
      }).trim();
      return [{ path, target }];
    });
}

/** Where the link resolves to, relative to the file that holds it. */
export function escapesRepo(linkPath: string, target: string, root: string = ROOT): boolean {
  const resolved = isAbsolute(target) ? target : resolve(root, dirname(linkPath), target);
  const rel = relative(root, resolved);
  return rel.startsWith('..') || isAbsolute(rel);
}

describe('tracked symlinks stay inside the repository', () => {
  it('finds no symlink pointing outside the repo root', () => {
    const offenders = trackedSymlinks()
      .filter((l) => escapesRepo(l.path, l.target))
      .map((l) => `${l.path} -> ${l.target}`);

    expect(offenders).toEqual([]);
  });

  // Negative control. Without these the first test would pass on a repo with
  // no symlinks at all, and would keep passing if the detection broke.
  it('detects an absolute target outside the repo', () => {
    expect(escapesRepo('node_modules', '/Users/someone/elsewhere/node_modules')).toBe(true);
  });

  it('detects a relative target that climbs out', () => {
    expect(escapesRepo('charts/insighta/link', '../../../outside')).toBe(true);
  });

  it('accepts a link that stays inside', () => {
    expect(escapesRepo('charts/insighta/link', '../bootstrap')).toBe(false);
    expect(escapesRepo('docs/link', 'design')).toBe(false);
  });
});

/**
 * The pattern that let it back in. A trailing slash matches directories only,
 * so the bare form has to be present as well.
 */
describe('.gitignore covers node_modules in both shapes', () => {
  it('ignores a symlink named node_modules, not only a directory', () => {
    const status = execFileSync('git', ['check-ignore', '-v', 'node_modules'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    // check-ignore prints the matching pattern; a directory-only pattern
    // would not match at all and the command would exit non-zero.
    expect(status).toMatch(/node_modules/);
  });
});
