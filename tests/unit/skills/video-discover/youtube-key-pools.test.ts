/**
 * CP492 — search vs videos key-pool separation. Bulk videos.list
 * (batch-video-collector) shared the search key pool and drained each Google
 * project's daily Queries quota, 429-ing the user-facing wizard search.list.
 * resolveVideosApiKeys gives videos.list its own pool, falling back to the
 * search pool until dedicated VIDEOS keys are provisioned (no behavior change).
 */

import {
  resolveSearchApiKeys,
  resolveVideosApiKeys,
} from '@/skills/plugins/video-discover/v2/youtube-client';

describe('resolveVideosApiKeys (CP492)', () => {
  test('uses dedicated YOUTUBE_API_KEY_VIDEOS_* pool when present', () => {
    const env = {
      YOUTUBE_API_KEY_SEARCH: 's1',
      YOUTUBE_API_KEY_SEARCH_2: 's2',
      YOUTUBE_API_KEY_VIDEOS: 'v1',
      YOUTUBE_API_KEY_VIDEOS_2: 'v2',
      YOUTUBE_API_KEY_VIDEOS_3: 'v3',
    };
    expect(resolveVideosApiKeys(env)).toEqual(['v1', 'v2', 'v3']);
    // CP512 — search resolves to a SINGLE key only (ToS quota-split fix); _2..N ignored.
    expect(resolveSearchApiKeys(env)).toEqual(['s1']);
  });

  // CP512 — search.list must NEVER spread across projects. resolveSearchApiKeys
  // returns at most one key, ignoring the _2..N slots that the old rotation used.
  describe('resolveSearchApiKeys — single key (CP512 ToS)', () => {
    test('ignores _2..N slots, returns only YOUTUBE_API_KEY_SEARCH', () => {
      const env = {
        YOUTUBE_API_KEY_SEARCH: 's1',
        YOUTUBE_API_KEY_SEARCH_2: 's2',
        YOUTUBE_API_KEY_SEARCH_8: 's8',
      };
      expect(resolveSearchApiKeys(env)).toEqual(['s1']);
    });
    test('falls back to legacy YOUTUBE_API_KEY', () => {
      expect(resolveSearchApiKeys({ YOUTUBE_API_KEY: 'legacy' })).toEqual(['legacy']);
    });
    test('empty when no search key set', () => {
      expect(resolveSearchApiKeys({})).toEqual([]);
    });
  });

  test('falls back to the SEARCH key when no VIDEOS keys (now single-key)', () => {
    // CP512 — SEARCH is single-key, so the VIDEOS fallback also yields one key.
    const env = { YOUTUBE_API_KEY_SEARCH: 's1', YOUTUBE_API_KEY_SEARCH_2: 's2' };
    expect(resolveVideosApiKeys(env)).toEqual(['s1']);
  });

  test('falls back to legacy YOUTUBE_API_KEY when neither pool set', () => {
    const env = { YOUTUBE_API_KEY: 'legacy' };
    expect(resolveVideosApiKeys(env)).toEqual(['legacy']);
  });

  test('VIDEOS pool ignores SEARCH keys (no cross-contamination)', () => {
    const env = { YOUTUBE_API_KEY_VIDEOS: 'v1', YOUTUBE_API_KEY_SEARCH: 's1' };
    expect(resolveVideosApiKeys(env)).toEqual(['v1']);
    expect(resolveSearchApiKeys(env)).toEqual(['s1']);
  });

  test('preserves slot order and skips gaps', () => {
    const env = {
      YOUTUBE_API_KEY_VIDEOS: 'v1',
      YOUTUBE_API_KEY_VIDEOS_3: 'v3', // gap at _2
    };
    expect(resolveVideosApiKeys(env)).toEqual(['v1', 'v3']);
  });
});
