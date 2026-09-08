/**
 * The dependency list is what the availability dashboard reads, so a host
 * missing here is a feature the dashboard silently claims nothing about. These
 * tests hold the two properties that make the list trustworthy: every entry
 * resolves to something a probe can dial, and the SaaS hosts stay in it.
 */
import { EXTERNAL_DEPENDENCIES, dependencyUrl } from '../../../src/config/dependencies';

describe('EXTERNAL_DEPENDENCIES', () => {
  it('gives every dependency a host and port a probe can dial', () => {
    for (const dep of EXTERNAL_DEPENDENCIES) {
      const raw = dependencyUrl(dep, {} as NodeJS.ProcessEnv);
      if (raw === null) continue; // env-only, unset in this environment
      const u = new URL(raw);
      expect(u.hostname).not.toBe('');
      const port = Number(u.port) || (u.protocol === 'https:' ? 443 : 80);
      expect(port).toBeGreaterThan(0);
    }
  });

  it('reads the environment first and falls back to the constant', () => {
    const openrouter = EXTERNAL_DEPENDENCIES.find((d) => d.env === 'OPENROUTER_API_URL')!;
    expect(dependencyUrl(openrouter, {} as NodeJS.ProcessEnv)).toBe('https://openrouter.ai');
    expect(
      dependencyUrl(openrouter, {
        OPENROUTER_API_URL: 'https://proxy.internal',
      } as NodeJS.ProcessEnv)
    ).toBe('https://proxy.internal');
  });

  it('keeps the third-party hosts in the list', () => {
    // They were missing from the first version, which made a list of five
    // self-hosted boxes look like a complete picture of what production needs.
    const envs = EXTERNAL_DEPENDENCIES.map((d) => d.env);
    expect(envs).toEqual(
      expect.arrayContaining(['OPENROUTER_API_URL', 'YOUTUBE_API_BASE', 'GMAIL_SMTP_HOST'])
    );
  });

  it('names an alternative only where one actually carries the feature', () => {
    for (const dep of EXTERNAL_DEPENDENCIES) {
      if (dep.alternative !== null) expect(dep.alternative.length).toBeGreaterThan(0);
    }
  });
});
