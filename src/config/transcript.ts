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
});

export interface TranscriptConfig {
  /** Mac Mini proxy base URL. Empty string ⇒ proxy disabled. */
  macMiniUrl: string;
  /** Bearer token (`x-transcript-token` header) for the Mac Mini proxy. */
  macMiniToken: string;
  /** True iff both URL and token are non-empty. */
  macMiniEnabled: boolean;
}

export function loadTranscriptConfig(env: NodeJS.ProcessEnv = process.env): TranscriptConfig {
  const parsed = transcriptEnvSchema.safeParse({
    MAC_MINI_TRANSCRIPT_URL: env['MAC_MINI_TRANSCRIPT_URL'],
    MAC_MINI_TRANSCRIPT_TOKEN: env['MAC_MINI_TRANSCRIPT_TOKEN'],
  });
  if (!parsed.success) {
    return { macMiniUrl: '', macMiniToken: '', macMiniEnabled: false };
  }
  const { MAC_MINI_TRANSCRIPT_URL: url, MAC_MINI_TRANSCRIPT_TOKEN: token } = parsed.data;
  return {
    macMiniUrl: url,
    macMiniToken: token,
    macMiniEnabled: url.length > 0 && token.length > 0,
  };
}
