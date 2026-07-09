/**
 * Transcript proxy configuration (Mac Mini Tailscale path).
 *
 * EC2 us-west-2 outbound to YouTube is rate-limited / returns false
 * "Transcript is disabled". The Mac Mini proxy (KR residential ISP IP)
 * is the primary transcript fetcher; EC2 falls back to direct
 * youtube-transcript only when the proxy is unreachable.
 *
 * Both values are optional — if unset the consumer treats the Mac Mini
 * path as disabled and uses the direct fallback unconditionally.
 *
 * Consumers (replace previous in-file `process.env` reads):
 *   - src/modules/caption/extractor.ts          (primary fetch path)
 *   - src/modules/chatbot-rag/video-context-loader.ts  (source label heuristic)
 *
 * Hardcode-audit baseline impact: removes 3 `process-env-direct-read`
 * violations (2 in extractor.ts + 1 in video-context-loader.ts).
 */

import { z } from 'zod';

const optionalStr = z.preprocess((v) => {
  if (v == null) return '';
  const s = String(v).trim();
  return s;
}, z.string());

export const transcriptEnvSchema = z.object({
  MAC_MINI_TRANSCRIPT_URL: optionalStr.default(''),
  MAC_MINI_TRANSCRIPT_TOKEN: optionalStr.default(''),
  // Azure App Service transcript proxy (2026-07-09) — an always-on cloud host
  // running the SAME Webshare-backed service, off EC2 (ToS: scraping must not
  // run on EC2). Fixes the Mac Mini SPOF (home machine + Tailscale cold-path).
  // Reuses MAC_MINI_TRANSCRIPT_TOKEN (the Azure service validates the same token).
  AZURE_TRANSCRIPT_URL: optionalStr.default(''),
});

/** One transcript proxy the extractor can forward a caption fetch to. */
export interface TranscriptProxy {
  name: string;
  url: string;
  token: string;
}

export interface TranscriptConfig {
  /**
   * Ordered proxy list — the extractor tries each in sequence and uses the
   * first that REACHES YouTube (segments or an authoritative "no captions").
   * Azure first (reliable always-on cloud), Mac Mini second (KR-IP fallback).
   */
  proxies: TranscriptProxy[];
  /** Mac Mini proxy base URL. Empty string ⇒ proxy disabled. (back-compat) */
  macMiniUrl: string;
  /** Bearer token (`x-transcript-token` header) for the Mac Mini proxy. */
  macMiniToken: string;
  /** True iff at least one proxy (Azure or Mac Mini) is configured. */
  macMiniEnabled: boolean;
}

export function loadTranscriptConfig(env: NodeJS.ProcessEnv = process.env): TranscriptConfig {
  const parsed = transcriptEnvSchema.safeParse({
    MAC_MINI_TRANSCRIPT_URL: env['MAC_MINI_TRANSCRIPT_URL'],
    MAC_MINI_TRANSCRIPT_TOKEN: env['MAC_MINI_TRANSCRIPT_TOKEN'],
    AZURE_TRANSCRIPT_URL: env['AZURE_TRANSCRIPT_URL'],
  });
  if (!parsed.success) {
    return { proxies: [], macMiniUrl: '', macMiniToken: '', macMiniEnabled: false };
  }
  const {
    MAC_MINI_TRANSCRIPT_URL: macUrl,
    MAC_MINI_TRANSCRIPT_TOKEN: token,
    AZURE_TRANSCRIPT_URL: azureUrl,
  } = parsed.data;

  // The shared token gates both proxies. Azure first, then Mac Mini.
  const proxies: TranscriptProxy[] = [];
  if (token.length > 0) {
    if (azureUrl.length > 0) proxies.push({ name: 'azure', url: azureUrl, token });
    if (macUrl.length > 0) proxies.push({ name: 'mac-mini', url: macUrl, token });
  }

  return {
    proxies,
    macMiniUrl: macUrl,
    macMiniToken: token,
    macMiniEnabled: proxies.length > 0,
  };
}
