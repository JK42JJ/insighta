/**
 * S1 — shape, before anyone reads anything.
 *
 * Mechanical and free: no model, no network. Shorts and clips under four
 * minutes cannot carry a claim worth grading, and dropping them here means the
 * expensive stages never see them. Run bfa50902 lost 363 of 820 rows to this
 * one rule.
 *
 * Duration comes from `videos.list` during the harvest's enrich pass. A row
 * without one is not a gap in the record — `videos.list` answers for every id
 * that exists, so a missing answer means the video is private, removed, or
 * region-blocked. Those are dropped under their own reason rather than
 * silently, so the funnel says which of the two rules did the work.
 */

import { MIN_DURATION_SECONDS } from '../../harvest';
import type { CorpusRow } from '../corpus';
import type { Stage, StageResult } from '../stage';

export const s1Format: Stage = {
  id: 'S1_format',
  what: `drop anything under ${MIN_DURATION_SECONDS / 60} minutes`,
  kind: 'machine',

  async run(input: CorpusRow[]): Promise<StageResult> {
    const survivors: Array<{ videoId: string }> = [];
    const drops: Array<{ videoId: string; reason: string }> = [];

    for (const v of input) {
      if (v.durationSeconds == null) {
        drops.push({ videoId: v.videoId, reason: 'unavailable' });
        continue;
      }
      if (v.durationSeconds < MIN_DURATION_SECONDS) {
        drops.push({ videoId: v.videoId, reason: 'short_or_under_4min' });
        continue;
      }
      survivors.push({ videoId: v.videoId });
    }

    return {
      survivors,
      drops,
      detail: { minDurationSeconds: MIN_DURATION_SECONDS },
    };
  },
};
