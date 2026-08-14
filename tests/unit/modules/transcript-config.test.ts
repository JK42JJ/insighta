/**
 * loadTranscriptConfig — proxy ordering + back-compat (2026-07-09 Azure fallback).
 * The extractor tries proxies in order: Azure (always-on cloud) BEFORE Mac Mini
 * (KR-IP fallback). The shared token gates both. Pure function over an injected
 * env — no config/index / no DB.
 */

import { loadTranscriptConfig } from '../../../src/config/transcript';

const TOKEN = 'shared-secret';
const AZURE = 'https://insighta-transcript-proxy-x.eastus2-01.azurewebsites.net';
const MAC = 'http://100.91.173.17:4242';

describe('loadTranscriptConfig', () => {
  it('orders Azure before Mac Mini when both are set', () => {
    const c = loadTranscriptConfig({
      MAC_MINI_TRANSCRIPT_URL: MAC,
      MAC_MINI_TRANSCRIPT_TOKEN: TOKEN,
      AZURE_TRANSCRIPT_URL: AZURE,
    } as NodeJS.ProcessEnv);
    expect(c.proxies.map((p) => p.name)).toEqual(['azure', 'mac-mini']);
    expect(c.proxies[0]).toEqual({ name: 'azure', url: AZURE, token: TOKEN });
    expect(c.proxies[1]).toEqual({ name: 'mac-mini', url: MAC, token: TOKEN });
    expect(c.macMiniEnabled).toBe(true);
  });

  it('uses only Azure when Mac Mini URL is unset (reuses the shared token)', () => {
    const c = loadTranscriptConfig({
      MAC_MINI_TRANSCRIPT_TOKEN: TOKEN,
      AZURE_TRANSCRIPT_URL: AZURE,
    } as NodeJS.ProcessEnv);
    expect(c.proxies.map((p) => p.name)).toEqual(['azure']);
    expect(c.macMiniEnabled).toBe(true);
  });

  it('uses only Mac Mini when Azure URL is unset (back-compat)', () => {
    const c = loadTranscriptConfig({
      MAC_MINI_TRANSCRIPT_URL: MAC,
      MAC_MINI_TRANSCRIPT_TOKEN: TOKEN,
    } as NodeJS.ProcessEnv);
    expect(c.proxies.map((p) => p.name)).toEqual(['mac-mini']);
    expect(c.macMiniUrl).toBe(MAC);
    expect(c.macMiniToken).toBe(TOKEN);
  });

  it('has no proxies when the shared token is unset (token gates both)', () => {
    const c = loadTranscriptConfig({
      MAC_MINI_TRANSCRIPT_URL: MAC,
      AZURE_TRANSCRIPT_URL: AZURE,
    } as NodeJS.ProcessEnv);
    expect(c.proxies).toEqual([]);
    expect(c.macMiniEnabled).toBe(false);
  });

  it('has no proxies when nothing is configured', () => {
    const c = loadTranscriptConfig({} as NodeJS.ProcessEnv);
    expect(c.proxies).toEqual([]);
    expect(c.macMiniEnabled).toBe(false);
  });
});
