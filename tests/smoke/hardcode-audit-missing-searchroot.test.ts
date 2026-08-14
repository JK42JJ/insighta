/**
 * A rule pointed at a directory the checkout does not have used to kill the
 * whole audit. `css-color-literal` searches `frontend/public/mobile`, which is
 * on main but not on older branches, and rg answers exit 2 there. runRg only
 * forgave exit 1, so the process died with a stack trace and the other five
 * rules never ran — an audit that reports nothing at all rather than a verdict.
 *
 * The repair has to keep two cases apart. Exit 1 is "searched, matched
 * nothing" and is a clean zero. Exit 2 with a missing path is "did not
 * search", which must never be recorded as zero: a rule counted at zero sits
 * under its baseline and reads as passing, and the baseline may only move
 * down, so a zero seeded from an absent directory would lock the rule shut.
 * These pin the classification the rest of that behaviour hangs on.
 */
export {};

import { classifyRgError } from '../../scripts/audit/hardcode-audit';

const rgMissingPathStderr = 'rg: frontend/public/mobile: No such file or directory (os error 2)\n';

describe('classifyRgError', () => {
  it('treats exit 1 as a completed search with no matches', () => {
    const outcome = classifyRgError({ status: 1, stdout: '', stderr: '' });
    expect(outcome).toEqual({ kind: 'output', stdout: '' });
  });

  it('keeps stdout that rg produced before exiting 1', () => {
    const outcome = classifyRgError({ status: 1, stdout: '{"type":"summary"}\n', stderr: '' });
    expect(outcome).toEqual({ kind: 'output', stdout: '{"type":"summary"}\n' });
  });

  it('reports a missing searchRoot rather than swallowing it as zero', () => {
    const outcome = classifyRgError({ status: 2, stdout: '', stderr: rgMissingPathStderr });
    expect(outcome).toEqual({
      kind: 'missing-path',
      message: rgMissingPathStderr.trim(),
    });
  });

  it('reads a Buffer stderr, which is what execSync hands back unencoded', () => {
    const outcome = classifyRgError({
      status: 2,
      stdout: '',
      stderr: Buffer.from(rgMissingPathStderr),
    });
    expect(outcome?.kind).toBe('missing-path');
  });

  it('declines any other failure so it keeps throwing', () => {
    // A bad regex is also exit 2, and it is not a missing path — surfacing it
    // as an unevaluated rule would hide a broken pattern behind a warning.
    expect(
      classifyRgError({ status: 2, stdout: '', stderr: 'rg: regex parse error\n' })
    ).toBeNull();
    expect(
      classifyRgError({ status: 127, stdout: '', stderr: 'rg: command not found\n' })
    ).toBeNull();
    expect(classifyRgError(new Error('spawn ENOENT'))).toBeNull();
  });
});
