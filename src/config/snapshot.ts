/**
 * Snapshot (figure get-or-extract) service configuration.
 *
 * The numerize step (frame → struct/latex/keyframe) runs on the pod
 * slidegen-service, called via the RunPod proxy pattern (same as the chatbot's
 * qwen-runpod path: a proxy URL + bearer token). Both values optional — unset
 * ⇒ extraction is DISABLED and get-or-extract serves from cache only (the demo
 * path: manual-warm rows are served without any live extraction).
 *
 * CP392 secret-vs-config: SNAPSHOT_SERVICE_URL is a proxy URL (not a credential,
 * visible in logs/docker inspect) ⇒ GitHub Variable. SNAPSHOT_SERVICE_TOKEN is a
 * bearer secret ⇒ GitHub Secret. (Mirror QWEN_LORA_API_URL var + RUNPOD_API_KEY
 * secret split.)
 */

import { z } from 'zod';

const optionalStr = z.preprocess((v) => {
  if (v == null) return '';
  return String(v).trim();
}, z.string());

export const snapshotEnvSchema = z.object({
  SNAPSHOT_SERVICE_URL: optionalStr.default(''),
  SNAPSHOT_SERVICE_TOKEN: optionalStr.default(''),
  // Overall budget for one numerize JOB (POST + poll + result). The job runs
  // the full acquire→frames→select→YOLO+Qwen pipeline — measured ~222s for a
  // single ts. 5min gives headroom; prod leaves this unset → default applies.
  SNAPSHOT_SERVICE_TIMEOUT_MS: z.coerce.number().int().positive().default(300_000),
});

export interface SnapshotConfig {
  /** Pod slidegen-service base URL. Empty ⇒ extraction disabled (cache-only). */
  serviceUrl: string;
  /** Bearer token for the service. */
  serviceToken: string;
  timeoutMs: number;
  /** True only when BOTH url + token are set. */
  enabled: boolean;
}

export function loadSnapshotConfig(env: NodeJS.ProcessEnv = process.env): SnapshotConfig {
  const parsed = snapshotEnvSchema.parse({
    SNAPSHOT_SERVICE_URL: env['SNAPSHOT_SERVICE_URL'],
    SNAPSHOT_SERVICE_TOKEN: env['SNAPSHOT_SERVICE_TOKEN'],
    SNAPSHOT_SERVICE_TIMEOUT_MS: env['SNAPSHOT_SERVICE_TIMEOUT_MS'],
  });
  const serviceUrl = parsed.SNAPSHOT_SERVICE_URL;
  const serviceToken = parsed.SNAPSHOT_SERVICE_TOKEN;
  return {
    serviceUrl,
    serviceToken,
    timeoutMs: parsed.SNAPSHOT_SERVICE_TIMEOUT_MS,
    enabled: serviceUrl.length > 0 && serviceToken.length > 0,
  };
}
