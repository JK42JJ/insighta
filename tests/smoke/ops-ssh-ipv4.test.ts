/**
 * scripts/ops/ssh.sh authorizes this machine's address on a security group and
 * then connects. If it authorizes the wrong address the connection times out,
 * and every layer anyone would think to check -- security group, route table,
 * NACL, instance status -- looks correct, because each of them is.
 *
 * That is not hypothetical. Measured 2026-08-14 on the k3s node:
 *
 *   curl -4 ifconfig.me            211.234.196.34     the address SSH leaves from
 *   curl    checkip.amazonaws.com  211.234.196.243    the address that got authorized
 *
 * One hour of diagnosis, ending at a rule for an address this machine does not
 * use. These tests pin the two properties that prevent it: every lookup forces
 * IPv4, and a disagreement between sources stops the script rather than
 * choosing one.
 *
 * The address-detection function is extracted from the script and run against a
 * stubbed curl, so this tests the behaviour rather than the text.
 */

import { execFileSync } from 'child_process';
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const SCRIPT = join(__dirname, '..', '..', 'scripts', 'ops', 'ssh.sh');

/**
 * Runs my_ipv4() from the script with `curl` replaced by a stub that prints
 * `responses` in order, one per invocation.
 */
function runWithStubbedCurl(responses: string[]): { ok: boolean; out: string } {
  const dir = mkdtempSync(join(tmpdir(), 'ssh-ipv4-'));
  try {
    writeFileSync(
      join(dir, 'curl'),
      `#!/usr/bin/env bash
n=$(cat "${dir}/n" 2>/dev/null || echo 0)
echo $((n + 1)) > "${dir}/n"
# Record the flags so a test can assert -4 was passed.
echo "$@" >> "${dir}/calls"
case "$n" in
${responses.map((r, i) => `  ${i}) printf '%s' '${r}' ;;`).join('\n')}
  *) exit 1 ;;
esac
`,
      { mode: 0o755 }
    );
    chmodSync(join(dir, 'curl'), 0o755);

    const script = readFileSync(SCRIPT, 'utf8');
    const start = script.indexOf('my_ipv4() {');
    const end = script.indexOf('\n}\n', start);
    if (start < 0 || end < 0) throw new Error('my_ipv4 not found in ssh.sh');
    const fn = script.slice(start, end + 3);

    const harness = join(dir, 'run.sh');
    writeFileSync(
      harness,
      `set -euo pipefail
die() { printf '%s\\n' "$*" >&2; exit 1; }
${fn}
my_ipv4
`
    );

    try {
      const out = execFileSync('bash', [harness], {
        env: { ...process.env, PATH: `${dir}:${process.env['PATH']}` },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return { ok: true, out };
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string };
      return { ok: false, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('scripts/ops/ssh.sh address detection', () => {
  it('returns the address when both sources agree', () => {
    const r = runWithStubbedCurl(['203.0.113.7', '203.0.113.7']);
    expect(r.ok).toBe(true);
    expect(r.out.trim()).toBe('203.0.113.7');
  });

  it('refuses when the two sources disagree', () => {
    // The exact shape of the bug: one lookup sees .34, another sees .243.
    const r = runWithStubbedCurl(['211.234.196.34', '211.234.196.243']);
    expect(r.ok).toBe(false);
    expect(r.out).toMatch(/disagree/i);
  });

  it('refuses an IPv6 answer rather than authorizing it as a v4 CIDR', () => {
    const v6 = '2001:2d8:f193:150c::1';
    const r = runWithStubbedCurl([v6, v6]);
    expect(r.ok).toBe(false);
    expect(r.out).toMatch(/IPv4/);
  });

  it('forces IPv4 on every address lookup', () => {
    // A lookup without -4 is how the wrong address was obtained. Assert on the
    // script text as well as the behaviour: a future edit that drops the flag
    // would still pass the stubbed-agreement test above, because the stub
    // cannot know which protocol a real curl would have chosen.
    const script = readFileSync(SCRIPT, 'utf8');
    const fn = script.slice(
      script.indexOf('my_ipv4() {'),
      script.indexOf('\n}\n', script.indexOf('my_ipv4() {'))
    );
    const lookups = fn.match(/curl[^\n]*/g) ?? [];
    expect(lookups.length).toBeGreaterThanOrEqual(2);
    for (const call of lookups) {
      expect(call).toMatch(/curl\s+-4\b/);
    }
  });

  // Negative control: the assertion above has to be able to fail, or it would
  // pass against a script that never forces IPv4 at all.
  it('the -4 assertion can fail', () => {
    const withFlag = 'curl -4 -s --max-time 6 ifconfig.me';
    const without = 'curl -s --max-time 6 ifconfig.me';
    expect(withFlag).toMatch(/curl\s+-4\b/);
    expect(without).not.toMatch(/curl\s+-4\b/);
  });
});
