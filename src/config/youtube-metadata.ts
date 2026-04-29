/**
 * YouTube metadata backfill config (CP437, 2026-04-29).
 *
 * Knobs for the prod-runtime cron that backfills the new
 * `youtube_videos.{comment_count,tags,topic_categories,has_caption,
 * default_language,metadata_fetched_at}` columns added in
 * `prisma/migrations/youtube-metadata-v2/001_add_fields.sql`.
 *
 * Default OFF — operator must explicitly flip
 * `YOUTUBE_METADATA_BACKFILL_ENABLED=true` after design review.
 *
 * Quota: videos.list = 1 unit per call regardless of parts. With
 * VIDEOS_LIST_MAX_IDS_PER_CALL=50 a 2,000-video batch consumes 40 units.
 * Combined with the user-facing search.list path (100 units/call), this
 * stays well within the 10,000 daily quota even when both run.
 */

import { z } from 'zod';

const boolFlag = z.preprocess((v) => {
  if (v == null || v === '') return false;
  const s = String(v).trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes';
}, z.boolean());

const positiveInt = z.preprocess(
  (v) => (v == null || v === '' ? undefined : Number(v)),
  z.number().finite().int().positive().optional()
);

export const youtubeMetadataEnvSchema = z.object({
  YOUTUBE_METADATA_BACKFILL_ENABLED: boolFlag.default(false as unknown as string),
  YOUTUBE_METADATA_BACKFILL_BATCH_SIZE: positiveInt.transform((v) => v ?? 2000),
  YOUTUBE_METADATA_BACKFILL_SCHEDULE: z
    .preprocess((v) => (v == null || v === '' ? '0 18 * * *' : String(v).trim()), z.string())
    .default('0 18 * * *'),
});

export interface YouTubeMetadataConfig {
  backfillEnabled: boolean;
  backfillBatchSize: number;
  backfillSchedule: string;
}

const FALLBACK: YouTubeMetadataConfig = {
  backfillEnabled: false,
  backfillBatchSize: 2000,
  backfillSchedule: '0 18 * * *',
};

export function loadYouTubeMetadataConfig(
  env: NodeJS.ProcessEnv = process.env
): YouTubeMetadataConfig {
  const parsed = youtubeMetadataEnvSchema.safeParse({
    YOUTUBE_METADATA_BACKFILL_ENABLED: env['YOUTUBE_METADATA_BACKFILL_ENABLED'],
    YOUTUBE_METADATA_BACKFILL_BATCH_SIZE: env['YOUTUBE_METADATA_BACKFILL_BATCH_SIZE'],
    YOUTUBE_METADATA_BACKFILL_SCHEDULE: env['YOUTUBE_METADATA_BACKFILL_SCHEDULE'],
  });
  if (!parsed.success) return FALLBACK;
  return {
    backfillEnabled: parsed.data.YOUTUBE_METADATA_BACKFILL_ENABLED,
    backfillBatchSize: parsed.data.YOUTUBE_METADATA_BACKFILL_BATCH_SIZE,
    backfillSchedule: parsed.data.YOUTUBE_METADATA_BACKFILL_SCHEDULE,
  };
}
