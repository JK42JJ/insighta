/**
 * S0 — harvest, in two layers, and write down what was found.
 *
 * Layer 1 reads the uploads playlist of every trusted channel at 1 unit a page.
 * Layer 2 runs the topic's queries through search.list at 100 units each.
 * Layer 1 guarantees the channels an editor decided matter are never missed
 * because a query happened not to match them; layer 2 finds the channels
 * nobody has decided about yet.
 *
 * The part that is new: the result is seeded into `newsletter_corpus`. Run
 * bfa50902 spent 4,039 quota units, recorded "868 -> 820", and kept none of
 * the 820 — so S1 could never be re-run, and the funnel it fed was a number
 * without a referent.
 */

import { harvest } from '../../harvest';
import * as corpus from '../corpus';
import type { Stage, StageContext, StageResult } from '../stage';

export const s0Harvest: Stage = {
  id: 'S0_harvest',
  what: 'trusted channels, then the topic queries',
  kind: 'machine',

  async run(_input, ctx: StageContext): Promise<StageResult> {
    // `harvest` is transport only. An earlier version of it wrote the S0 and
    // S1 ledger rows itself and applied S1's filter inline, which made the two
    // stages one unit: S1 could not be re-run, and the runner's own recordStep
    // would have collided with it on the unique (run_id, stage) index.
    const result = await harvest({
      runId: ctx.runId,
      topic: ctx.topic,
      ...(ctx.fetchImpl ? { fetchImpl: ctx.fetchImpl } : {}),
    });

    await corpus.seed(
      ctx.runId,
      result.videos.map((v) => ({
        videoId: v.videoId,
        title: v.title,
        channelId: v.channelId,
        channelTitle: v.channelTitle,
        publishedAt: v.publishedAt,
        durationSeconds: v.durationSeconds,
        viewCount: v.viewCount,
        source: v.source,
        query: v.query,
      }))
    );

    return {
      survivors: result.videos.map((v) => ({ videoId: v.videoId })),
      // A video both layers found is one row, never two. There is no corpus
      // row to mark, so the drop is reported to the ledger through `itemsIn`
      // and `dropReasons` rather than by inventing ids that refer to nothing.
      drops: [],
      itemsIn: result.rawTotal,
      rawDropReasons: result.duplicates > 0 ? { duplicate_video_id: result.duplicates } : {},
      quotaUnits: result.quotaUnits,
      detail: {
        trustedVideos: result.videos.filter((v) => v.source === 'trusted').length,
        searchVideos: result.videos.filter((v) => v.source === 'search').length,
        queries: [...ctx.topic.queries.ko, ...ctx.topic.queries.en].length,
        videoCategoryIds: ctx.topic.videoCategoryIds,
      },
    };
  },
};
