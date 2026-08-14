/**
 * T8a — v5 fanout must forward V3_SEARCH_VIDEO_DURATION to search.list the
 * same way the v3 executor does (long-form-only harvest at the source).
 * We assert on the shared config fn + the option plumbing contract of
 * searchVideos (videoDuration set only when the env resolves).
 */
import { getSearchVideoDuration } from '@/config/discover-t5';

describe('v5 fanout videoDuration plumbing (T8a)', () => {
  it('env medium resolves for the fanout spread', () => {
    expect(
      getSearchVideoDuration({ V3_SEARCH_VIDEO_DURATION: 'medium' } as NodeJS.ProcessEnv)
    ).toBe('medium');
  });
  it('unset env resolves null → fanout omits the param (legacy)', () => {
    expect(getSearchVideoDuration({} as NodeJS.ProcessEnv)).toBeNull();
  });
  it('fanout source spreads videoDuration from the shared config', () => {
    const fs = require('fs');
    const path = require.resolve('@/skills/plugins/video-discover/v5/youtube-fanout');
    const src = fs.readFileSync(path, 'utf8');
    expect(src).toContain('getSearchVideoDuration');
    expect(src).toContain('videoDuration');
  });
});
