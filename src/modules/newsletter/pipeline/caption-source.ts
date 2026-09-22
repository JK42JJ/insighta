/**
 * Where S8 gets caption text.
 *
 * The policy that shapes this file: full captions live on the Mac Mini and
 * nowhere else. They are not stored in Postgres, not cached on the API box,
 * and not written to disk here. This module fetches a caption, hands it to the
 * caller, and keeps no copy. `videos.transcript_fetched_at` is a timestamp,
 * not a document, and that is deliberate.
 *
 * It does not speak to the collector itself. An earlier version of this file
 * did, against `GET /captions/:videoId` with an `x-internal-token` header, and
 * that endpoint does not exist: the service answers `GET /transcript/:videoId`
 * with `x-transcript-token` and a JSON body. Written from the v2.1 document
 * rather than from the running service, it would have returned 404 for every
 * video and recorded the result as "this video has no captions" -- the one
 * confusion the S8 contract says must never happen.
 *
 * Where this can run matters. The transcript proxies are reachable from the
 * cluster and from nowhere else -- one is on a Tailscale address, the other on
 * a private host, which is why Keel asks the pod for /health/dependencies
 * rather than probing them from its runner. A pipeline run on a GitHub runner
 * therefore gets null for every video, and the ledger records that as
 * `withoutCaptions`, correctly and uselessly. S8 belongs where the captions
 * are.
 *
 * So the fetch is not reimplemented here. `CaptionExtractor` already holds the
 * contract, the proxy order (Azure, then Mac Mini), the language fallback and
 * the timeouts, and it is explicitly in-memory: it returns the text and
 * persists nothing. One caller, one contract, one place to fix it.
 */

import { logger } from '@/utils/logger';
import { getCaptionExtractor, type CaptionExtractor } from '@/modules/caption/extractor';
import type { CaptionSource } from './stages/s8-evidence';

const log = logger.child({ module: 'newsletter/captions' });

/**
 * Reads captions through the transcript proxies.
 *
 * Every failure returns null rather than throwing. A stage that dies because
 * one video's caption is missing produces no evidence at all, and a brief with
 * eleven sources instead of twelve is a smaller brief, not a broken one. What
 * the run must not do is silently treat "the proxies are down" as "this video
 * has no captions" -- so the two are logged differently, and the extractor
 * already separates them: it reports `transcript proxies unreachable` for the
 * first and returns an empty caption for the second.
 */
export function proxyCaptions(extractor: CaptionExtractor = getCaptionExtractor()): CaptionSource {
  return {
    async get(videoId: string): Promise<string | null> {
      try {
        const result = await extractor.extractCaptions(videoId);
        if (!result.success || !result.caption) {
          // `error` carries which of the two it was; both end with no quotes,
          // and only one of them is fixed by restarting a host.
          log.warn('no captions', { videoId, reason: result.error ?? 'unknown' });
          return null;
        }
        const text = result.caption.fullText.trim();
        return text.length > 0 ? text : null;
      } catch (err) {
        log.warn('caption fetch threw', {
          videoId,
          error: err instanceof Error ? err.message : String(err),
        });
        return null;
      }
    },
  };
}

/**
 * The source used when captions must not be fetched at all.
 *
 * Named for what it is. A run against this produces zero evidence rows and a
 * ledger line saying every video was without captions, which is the honest
 * reading: the pipeline did not reach the captions, so it has no quotes, so no
 * claim can be graded above what its metadata supports. Used by tests and by
 * any run that must not spend a Webshare fetch.
 */
export const noCaptions: CaptionSource = {
  get: async () => null,
};
