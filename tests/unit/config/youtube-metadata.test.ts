/**
 * YouTube metadata config (CP437).
 */

import { loadYouTubeMetadataConfig } from '@/config/youtube-metadata';

describe('loadYouTubeMetadataConfig', () => {
  test('defaults — backfill OFF, batch 2000, schedule 0 18 * * *', () => {
    expect(loadYouTubeMetadataConfig({})).toEqual({
      backfillEnabled: false,
      backfillBatchSize: 2000,
      backfillSchedule: '0 18 * * *',
    });
  });

  test('YOUTUBE_METADATA_BACKFILL_ENABLED parses booleans', () => {
    expect(
      loadYouTubeMetadataConfig({ YOUTUBE_METADATA_BACKFILL_ENABLED: 'true' }).backfillEnabled
    ).toBe(true);
    expect(
      loadYouTubeMetadataConfig({ YOUTUBE_METADATA_BACKFILL_ENABLED: '1' }).backfillEnabled
    ).toBe(true);
    expect(
      loadYouTubeMetadataConfig({ YOUTUBE_METADATA_BACKFILL_ENABLED: 'false' }).backfillEnabled
    ).toBe(false);
    expect(
      loadYouTubeMetadataConfig({ YOUTUBE_METADATA_BACKFILL_ENABLED: '' }).backfillEnabled
    ).toBe(false);
  });

  test('YOUTUBE_METADATA_BACKFILL_BATCH_SIZE accepts positive int', () => {
    expect(
      loadYouTubeMetadataConfig({ YOUTUBE_METADATA_BACKFILL_BATCH_SIZE: '500' }).backfillBatchSize
    ).toBe(500);
  });

  test('invalid batch size falls back to 2000', () => {
    expect(
      loadYouTubeMetadataConfig({ YOUTUBE_METADATA_BACKFILL_BATCH_SIZE: '0' }).backfillBatchSize
    ).toBe(2000);
    expect(
      loadYouTubeMetadataConfig({ YOUTUBE_METADATA_BACKFILL_BATCH_SIZE: 'garbage' })
        .backfillBatchSize
    ).toBe(2000);
  });

  test('schedule passes through valid cron string', () => {
    const cfg = loadYouTubeMetadataConfig({
      YOUTUBE_METADATA_BACKFILL_SCHEDULE: '*/30 * * * *',
    });
    expect(cfg.backfillSchedule).toBe('*/30 * * * *');
  });

  test('empty schedule falls back to 0 18 * * *', () => {
    expect(loadYouTubeMetadataConfig({}).backfillSchedule).toBe('0 18 * * *');
    expect(
      loadYouTubeMetadataConfig({ YOUTUBE_METADATA_BACKFILL_SCHEDULE: '' }).backfillSchedule
    ).toBe('0 18 * * *');
  });
});
