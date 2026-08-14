/**
 * T5 supply/quality knobs (2026-07-12). Unset = legacy (flag alone rolls back).
 */
import { getSearchVideoDuration, isSkipRuleQueriesEnabled } from '@/config/discover-t5';

describe('discover-t5 knobs', () => {
  test('videoDuration: unset/invalid → null (legacy, no param)', () => {
    expect(getSearchVideoDuration({})).toBeNull();
    expect(getSearchVideoDuration({ V3_SEARCH_VIDEO_DURATION: 'any' })).toBeNull();
    expect(getSearchVideoDuration({ V3_SEARCH_VIDEO_DURATION: 'x' })).toBeNull();
  });
  test.each(['medium', 'long', 'short', ' MEDIUM '])('videoDuration accepts %s', (v) => {
    expect(getSearchVideoDuration({ V3_SEARCH_VIDEO_DURATION: v })).toBe(v.trim().toLowerCase());
  });
  test('skipRuleQueries: unset → false; true/1/yes → true', () => {
    expect(isSkipRuleQueriesEnabled({})).toBe(false);
    expect(isSkipRuleQueriesEnabled({ DISCOVER_SKIP_RULE_QUERIES: 'true' })).toBe(true);
    expect(isSkipRuleQueriesEnabled({ DISCOVER_SKIP_RULE_QUERIES: '1' })).toBe(true);
    expect(isSkipRuleQueriesEnabled({ DISCOVER_SKIP_RULE_QUERIES: 'false' })).toBe(false);
  });
});
