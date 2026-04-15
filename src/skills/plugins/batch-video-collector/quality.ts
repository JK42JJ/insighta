/**
 * batch-video-collector — quality gates & tier classification.
 *
 * Pure, no I/O. Unit-tested in __tests__/quality-tier.test.ts.
 */

import {
  QUALITY_GOLD_VIEW_COUNT,
  QUALITY_SILVER_VIEW_COUNT,
  QUALITY_BRONZE_VIEW_COUNT,
  MIN_DURATION_SEC,
  MAX_DURATION_SEC,
} from './manifest';
import { titleHitsBlocklist } from '../video-discover/v2/youtube-client';

export type QualityTier = 'gold' | 'silver' | 'bronze';

export interface QualityInput {
  title: string;
  viewCount: number | null;
  durationSec: number | null;
}

export interface QualityVerdict {
  /** True if the video is admissible to video_pool at any tier. */
  accepted: boolean;
  reason?: 'below_view_floor' | 'too_short' | 'too_long' | 'title_blocklist' | 'missing_metadata';
  tier?: QualityTier;
}

export function classifyQuality(input: QualityInput): QualityVerdict {
  if (input.viewCount == null) {
    return { accepted: false, reason: 'missing_metadata' };
  }
  if (input.viewCount < QUALITY_BRONZE_VIEW_COUNT) {
    return { accepted: false, reason: 'below_view_floor' };
  }
  if (input.durationSec == null) {
    return { accepted: false, reason: 'missing_metadata' };
  }
  if (input.durationSec < MIN_DURATION_SEC) {
    return { accepted: false, reason: 'too_short' };
  }
  if (input.durationSec > MAX_DURATION_SEC) {
    return { accepted: false, reason: 'too_long' };
  }
  if (titleHitsBlocklist(input.title)) {
    return { accepted: false, reason: 'title_blocklist' };
  }
  const tier: QualityTier =
    input.viewCount >= QUALITY_GOLD_VIEW_COUNT
      ? 'gold'
      : input.viewCount >= QUALITY_SILVER_VIEW_COUNT
        ? 'silver'
        : 'bronze';
  return { accepted: true, tier };
}
