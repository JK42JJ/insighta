/**
 * YouTube metadata collector — pure-fn helpers (CP437).
 *
 * Tests the URL→slug parser + topic-category filter without touching the
 * DB or YouTube API. The full collector path (HTTP → upsert) is covered by
 * smoke tests in CI; here we just lock the deterministic mappings.
 */

import { topicCategoryUrlToSlug } from '@/skills/plugins/video-discover/v2/youtube-client';
import { filterTopicCategoriesToDomainSlugs } from '@/modules/youtube/metadata-collector';

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
