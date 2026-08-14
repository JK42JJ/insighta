/**
 * Curation interest-profile analysis — unit tests (Growth Hub, 2026-07-20).
 * Design: docs/design/growth-hub-curation-personalized-2026-07-20.md (§2, §4).
 *
 * Deps are injected mocks — NO real YouTube calls. Keyword extraction is LOCAL
 * (taxonomy match, no LLM). Verifies source weighting (saved > sub), domain
 * tagging, and normalization.
 */

import {
  collectAccountSignals,
  buildInterestProfile,
  type InterestProfileDeps,
} from '@/modules/curation/interest-profile';
import { mapKeywordToDomain, extractTaxonomyKeywords } from '@/modules/curation/domain-taxonomy';
import { INTEREST_WEIGHTS } from '@/modules/curation/config';

/** Build a deps mock from fixed fixtures. */
function makeDeps(over: Partial<InterestProfileDeps> = {}): InterestProfileDeps {
  return {
    getUserSubscriptions: async () =>
      ({
        items: [{ channelId: 'c1', title: 'Two Minute Papers — AI 논문', description: '' }],
        totalResults: 1,
      }) as any,
    getUserPlaylists: async () =>
      ({
        items: [{ playlistId: 'pl1', title: '주식 투자 공부', description: '' }],
        totalResults: 1,
      }) as any,
    getPlaylistItems: async () =>
      ({ items: [{ videoId: 'v1', position: 0 }], totalResults: 1 }) as any,
    getVideosMetadata: async () =>
      [{ videoId: 'v1', title: 'ETF 배당 투자 전략', description: '', channelId: 'c9' }] as any,
    ...over,
  };
}

describe('mapKeywordToDomain', () => {
  it('maps AI/ML, investment, career, and defaults to other', () => {
    expect(mapKeywordToDomain('Claude 모델')).toBe('ai_ml');
    expect(mapKeywordToDomain('ETF 투자')).toBe('investment');
    expect(mapKeywordToDomain('면접 준비')).toBe('career');
    expect(mapKeywordToDomain('바이올린 연주')).toBe('other');
  });
});

describe('extractTaxonomyKeywords', () => {
  it('extracts matched patterns with domains; empty for unknown areas', () => {
    const ai = extractTaxonomyKeywords('MCP 기반 AI 에이전트 개발');
    expect(ai.map((k) => k.kw)).toEqual(expect.arrayContaining(['ai']));
    expect(ai.find((k) => k.kw === 'ai')?.domain).toBe('ai_ml');
    expect(extractTaxonomyKeywords('오늘 점심 뭐먹지')).toHaveLength(0);
  });
});

describe('collectAccountSignals', () => {
  it('tags saved videos with save weight and subs with sub weight', async () => {
    const signals = await collectAccountSignals('u1', makeDeps());
    expect(signals.titleWeights.get('Two Minute Papers — AI 논문')).toBe(INTEREST_WEIGHTS.sub);
    expect(signals.titleWeights.get('ETF 배당 투자 전략')).toBe(INTEREST_WEIGHTS.save);
    expect(signals.counts.savedVideos).toBe(1);
  });
});

describe('buildInterestProfile', () => {
  it('produces a normalized, domain-tagged profile; saved-video keyword outranks sub', async () => {
    const profile = await buildInterestProfile('u1', makeDeps());
    const kws = profile.map((p) => p.kw);
    expect(kws).toContain('ai'); // from the subscription (sub weight)
    expect(kws).toContain('etf'); // from the saved video (save weight)

    expect(Math.max(...profile.map((p) => p.weight))).toBe(1); // normalized

    const etf = profile.find((p) => p.kw === 'etf');
    const ai = profile.find((p) => p.kw === 'ai');
    expect(etf?.domain).toBe('investment');
    expect(ai?.domain).toBe('ai_ml');
    // saved-video keyword (save 0.6) outranks subscription keyword (sub 0.4)
    expect(etf!.weight).toBeGreaterThan(ai!.weight);
  });

  it('returns empty when nothing matches the taxonomy', async () => {
    const deps = makeDeps({
      getUserSubscriptions: async () =>
        ({
          items: [{ channelId: 'c', title: '오늘의 브이로그', description: '' }],
          totalResults: 1,
        }) as any,
      getUserPlaylists: async () => ({ items: [], totalResults: 0 }) as any,
      getVideosMetadata: async () => [] as any,
    });
    expect(await buildInterestProfile('u1', deps)).toHaveLength(0);
  });
});
