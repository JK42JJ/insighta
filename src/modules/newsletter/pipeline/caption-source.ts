/**
 * Where S8 gets caption text.
 *
 * The policy that shapes this file: full captions live on the Mac Mini and
 * nowhere else. They are not stored in Postgres, not cached on the API box,
 * and not written to disk here. This module fetches a caption, hands it to the
 * caller, and keeps no copy. `videos.transcript_fetched_at` is a timestamp,
 * not a document, and that is deliberate.
 *
 * The collector's HTTP endpoint (`GET /captions/:videoId`, v2.1 section 2)
 * does not exist yet -- the Mac Mini runs the fetcher as a LaunchAgent writing
 * to a local cache, with no server in front of it. So this ships with the
 * interface and a null source, and the run ledger records how many videos had
 * no caption rather than pretending they all did. Building that endpoint is
 * its own change; guessing at its shape here would be worse than saying it is
 * missing.
 */

import { logger } from '@/utils/logger';
import type { CaptionSource } from './stages/s8-evidence';

const log = logger.child({ module: 'newsletter/captions' });

/** Longer than this and the collector is down, not slow. */
const TIMEOUT_MS = 8_000;

export interface CollectorConfig {
  /** Base URL of the collector on the Mac Mini, over Tailscale. */
  baseUrl: string;
  /** Shared secret, the same header the internal routes check. */
  token: string;
}

/**
 * Reads captions from the collector.
 *
 * Every failure returns null rather than throwing. A stage that dies because
 * one video's caption is missing produces no evidence at all, and a brief with
 * eleven sources instead of twelve is a smaller brief, not a broken one. What
 * the run must not do is silently treat "the collector is down" as "this video
 * has no captions" -- so the two are logged differently.
 */
export function collectorCaptions(
  config: CollectorConfig,
  fetchImpl: typeof fetch = fetch
): CaptionSource {
  return {
    async get(videoId: string): Promise<string | null> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const res = await fetchImpl(`${config.baseUrl}/captions/${videoId}`, {
          headers: { 'x-internal-token': config.token },
          signal: controller.signal,
        });
        if (res.status === 404) return null; // fetched, and there is nothing there
        if (!res.ok) {
          log.warn('collector refused', { videoId, status: res.status });
          return null;
        }
        const text = await res.text();
        return text.trim().length > 0 ? text : null;
      } catch (err) {
        log.warn('collector unreachable', {
          videoId,
          error: err instanceof Error ? err.message : String(err),
        });
        return null;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/**
 * The source used when no collector is configured.
 *
 * Named for what it is. A run against this produces zero evidence rows and a
 * ledger line saying every video was without captions, which is the honest
 * reading: the pipeline cannot reach the captions, so it has no quotes, so no
 * claim can be graded above what its metadata supports.
 */
export const noCaptions: CaptionSource = {
  get: async () => null,
};
