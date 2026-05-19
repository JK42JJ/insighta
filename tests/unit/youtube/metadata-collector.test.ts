/**
 * YouTube metadata collector — pure-fn helpers (CP437).
 *
 * Tests the URL→slug parser + topic-category filter without touching the
 * DB or YouTube API. The full collector path (HTTP → upsert) is covered by
 * smoke tests in CI; here we just lock the deterministic mappings.
 */

import { topicCategoryUrlToSlug } from '@/skills/plugins/video-discover/v2/youtube-client';
import type { YouTubeVideoFullMetadata } from '@/skills/plugins/video-discover/v2/youtube-client';
import {
  filterTopicCategoriesToDomainSlugs,
  mapToColumns,
} from '@/modules/youtube/metadata-collector';

describe('topicCategoryUrlToSlug', () => {
  test('canonical /wiki/Health → health', () => {
    expect(topicCategoryUrlToSlug('https://en.wikipedia.org/wiki/Health')).toBe('health');
  });

  test('multi-word /wiki/Lifestyle_(sociology) drops disambig + collapses underscores', () => {
    expect(topicCategoryUrlToSlug('https://en.wikipedia.org/wiki/Lifestyle_(sociology)')).toBe(
      'lifestyle'
    );
  });

  test('multi-word /wiki/Mind_(philosophy) → mind', () => {
    expect(topicCategoryUrlToSlug('https://en.wikipedia.org/wiki/Mind_(philosophy)')).toBe('mind');
  });

  test('non-wiki URL → empty string', () => {
    expect(topicCategoryUrlToSlug('https://example.com/Health')).toBe('');
  });

  test('url-encoded wiki path is decoded', () => {
    expect(topicCategoryUrlToSlug('https://en.wikipedia.org/wiki/Sport%20%28activity%29')).toMatch(
      /sport/
    );
  });

  test('strict slug match for tech domain', () => {
    expect(topicCategoryUrlToSlug('https://en.wikipedia.org/wiki/Technology')).toBe('technology');
    // Note: 'technology' is NOT a DOMAIN slug ('tech' is). filter step below maps.
  });
});

describe('filterTopicCategoriesToDomainSlugs', () => {
  test('keeps only the 9 SSOT slugs from a mixed input', () => {
    const raw = ['health', 'sport', 'lifestyle', 'unknown', 'mind', 'finance', 'sport'];
    const filtered = filterTopicCategoriesToDomainSlugs(raw);
    expect(filtered).toEqual(['health', 'lifestyle', 'mind', 'finance']);
  });

  test('returns empty when none match', () => {
    expect(filterTopicCategoriesToDomainSlugs(['sport', 'politics', 'music'])).toEqual([]);
  });

  test('dedupes when a slug appears twice', () => {
    expect(filterTopicCategoriesToDomainSlugs(['tech', 'tech', 'health'])).toEqual([
      'tech',
      'health',
    ]);
  });
});

// CP474 — 14 new fields from videos.list (snippet / contentDetails / status).
describe('mapToColumns (CP474 full metadata)', () => {
  const NOW = new Date('2026-05-19T00:00:00Z');

  test('maps all 14 new fields when present', () => {
    const item: YouTubeVideoFullMetadata = {
      snippet: {
        title: 't',
        tags: ['a', 'b'],
        categoryId: '27',
        channelId: 'UCxyz',
        defaultLanguage: 'ko',
        defaultAudioLanguage: 'ko-KR',
        liveBroadcastContent: 'none',
        localized: { title: '제목', description: '설명' },
        thumbnails: {
          default: { url: 'd' },
          high: { url: 'h' },
          maxres: { url: 'm' },
        },
      },
      contentDetails: {
        duration: 'PT5M',
        caption: 'true',
        dimension: '2d',
        definition: 'hd',
        licensedContent: true,
        projection: 'rectangular',
        regionRestriction: { blocked: ['CN'] },
      },
      statistics: { viewCount: '100' },
      status: { uploadStatus: 'processed', privacyStatus: 'public' },
    };
    const cols = mapToColumns(item, NOW) as Record<string, unknown>;
    expect(cols['category_id']).toBe('27');
    expect(cols['channel_id']).toBe('UCxyz');
    expect(cols['default_audio_language']).toBe('ko-KR');
    expect(cols['live_broadcast_content']).toBe('none');
    expect(cols['localized_title']).toBe('제목');
    expect(cols['localized_description']).toBe('설명');
    expect(cols['thumbnails']).toBeTruthy();
    expect(cols['dimension']).toBe('2d');
    expect(cols['definition']).toBe('hd');
    expect(cols['licensed_content']).toBe(true);
    expect(cols['projection']).toBe('rectangular');
    expect(cols['region_restriction']).toBeTruthy();
    expect(cols['upload_status']).toBe('processed');
    expect(cols['privacy_status']).toBe('public');
  });

  test('leaves all 14 new fields null when absent', () => {
    const cols = mapToColumns({ snippet: { title: 't' } }, NOW) as Record<string, unknown>;
    for (const key of [
      'category_id',
      'channel_id',
      'default_audio_language',
      'live_broadcast_content',
      'localized_title',
      'localized_description',
      'thumbnails',
      'dimension',
      'definition',
      'licensed_content',
      'projection',
      'region_restriction',
      'upload_status',
      'privacy_status',
    ]) {
      expect(cols[key]).toBeNull();
    }
  });

  test('region_restriction is null when both allowed and blocked are empty', () => {
    const cols = mapToColumns(
      { contentDetails: { regionRestriction: { allowed: [], blocked: [] } } },
      NOW
    ) as Record<string, unknown>;
    expect(cols['region_restriction']).toBeNull();
  });
});
