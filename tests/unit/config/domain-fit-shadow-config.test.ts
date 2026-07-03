/**
 * domain-fit-shadow config — default-off + env-default rule pin.
 *
 * CLAUDE.md "신규 env default = 기존 동작" — unset must resolve to enabled:false
 * and the frozen T3 Ollama endpoint/model, never throwing on a missing env.
 */
import { loadDomainFitShadowConfig } from '@/config/domain-fit-shadow';

describe('loadDomainFitShadowConfig', () => {
  it('defaults to disabled with the frozen T3 Ollama endpoint (unset env)', () => {
    const cfg = loadDomainFitShadowConfig({});
    expect(cfg.enabled).toBe(false);
    expect(cfg.ollamaUrl).toBe('http://100.91.173.17:11434');
    expect(cfg.model).toBe('mandala-gen:latest');
    expect(cfg.timeoutMs).toBe(5000);
    expect(cfg.concurrency).toBe(4);
    expect(cfg.maxCandidates).toBe(40);
  });

  it('parses DOMAIN_FIT_SHADOW=true and overrides', () => {
    const cfg = loadDomainFitShadowConfig({
      DOMAIN_FIT_SHADOW: 'true',
      DOMAIN_FIT_SHADOW_MAX_CANDIDATES: '10',
      DOMAIN_FIT_SHADOW_CONCURRENCY: '2',
    } as NodeJS.ProcessEnv);
    expect(cfg.enabled).toBe(true);
    expect(cfg.maxCandidates).toBe(10);
    expect(cfg.concurrency).toBe(2);
  });

  it('treats DOMAIN_FIT_SHADOW=false explicitly as disabled (not truthy-coerced)', () => {
    const cfg = loadDomainFitShadowConfig({ DOMAIN_FIT_SHADOW: 'false' } as NodeJS.ProcessEnv);
    expect(cfg.enabled).toBe(false);
  });

  it('falls back to safe defaults on a malformed numeric override', () => {
    const cfg = loadDomainFitShadowConfig({
      DOMAIN_FIT_SHADOW_MAX_CANDIDATES: 'not-a-number',
    } as NodeJS.ProcessEnv);
    expect(cfg.enabled).toBe(false);
    expect(cfg.maxCandidates).toBe(40);
  });
});
