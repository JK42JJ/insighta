/**
 * Transcript proxy configuration (Mac Mini Tailscale path).
 *
 * EC2 us-west-2 outbound to YouTube is rate-limited / returns false
 * "Transcript is disabled". The Mac Mini proxy (KR residential ISP IP)
 * is the primary transcript fetcher; EC2 falls back to direct
 * There is no direct-to-YouTube fallback: an unreachable proxy means the
 * extraction fails, which is the correct outcome.
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
  // running the same Webshare-backed service, off EC2 (ToS: scraping must not
  // run on EC2). Meant to fix the Mac Mini SPOF, and it did not, because it was
  // never reachable: the config sent it MAC_MINI_TRANSCRIPT_TOKEN on the belief
  // that "the Azure service validates the same token", and measurement on
  // 2026-09-08 answered 401 on every path -- the host is up, the credential is
  // wrong. A comment asserting a fact nobody had tested left the second proxy
  // dead for two months while it appeared configured.
  //
  // Its own token now, falling back to the shared one so nothing breaks if they
  // really are the same somewhere.
  AZURE_TRANSCRIPT_URL: optionalStr.default(''),
  AZURE_TRANSCRIPT_TOKEN: optionalStr.default(''),
});

/**
 * How long a caption fetch may take before the extractor gives up on a proxy.
 *
 * The proxy runs yt-dlp behind a rotating Webshare exit, so this covers a real
 * download, not a handshake.
 */
export const PROXY_FETCH_TIMEOUT_MS = 30_000;

/**
 * How long a reachability probe may take before the proxy counts as down.
 *
 * Measured against prod 2026-09-21, six consecutive probes of
 * `/health/dependencies`: azure answered AbortError, AbortError, 4159ms,
 * 1544ms, 1537ms, 1543ms; mac-mini 1525-1539ms throughout. The two aborts were
 * the 5 s ceiling this constant replaced, hit while the Azure App Service Free
 * instance was waking -- the third probe, at 4159 ms, is the same host awake.
 * So the old ceiling reported a proxy as down that the extractor, waiting
 * 30 s, would have used. Keel's own check flipped 8 times in 13 runs on that.
 *
 * The invariant that matters: probe < fetch. A probe that outlives the fetch
 * would pass a proxy the extractor then times out on -- the monitor would be
 * reporting health the product does not have. Keel's client budget must in turn
 * outlive this (scripts/keel/checks.ts), or the check fails on its own timeout
 * instead of the proxy's.
 */
export const PROXY_PROBE_TIMEOUT_MS = 15_000;

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
    AZURE_TRANSCRIPT_TOKEN: azureToken,
  } = parsed.data;

  // Each proxy carries its own credential, and each is registered only when it
  // has one. The previous form gated both on the Mac Mini token, so a missing
  // Azure token was invisible: the proxy appeared in the list and answered 401.
  // Azure first (always-on cloud), Mac Mini second (KR-IP fallback).
  const proxies: TranscriptProxy[] = [];
  const azureAuth = azureToken.length > 0 ? azureToken : token;
  if (azureUrl.length > 0 && azureAuth.length > 0) {
    proxies.push({ name: 'azure', url: azureUrl, token: azureAuth });
  }
  if (macUrl.length > 0 && token.length > 0) {
    proxies.push({ name: 'mac-mini', url: macUrl, token });
  }

  return {
    proxies,
    macMiniUrl: macUrl,
    macMiniToken: token,
    macMiniEnabled: proxies.length > 0,
  };
}
