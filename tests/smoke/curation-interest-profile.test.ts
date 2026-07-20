/**
 * Curation interest-profile analysis — unit tests (Growth Hub, 2026-07-20).
 * Design: docs/design/growth-hub-curation-personalized-2026-07-20.md (§2, §4).
 *
 * Deps are injected mocks — NO real YouTube/LLM calls. Verifies the analysis
 * algorithm: source weighting (saved > sub), learning gate, domain tagging,
 * normalization.
 */

import {
  collectAccountSignals,
  buildInterestProfile,
  type InterestProfileDeps,
} from '@/modules/curation/interest-profile';
import { mapKeywordToDomain } from '@/modules/curation/domain-taxonomy';
import { INTEREST_WEIGHTS, KEYWORD_LEARNING_FLOOR } from '@/modules/curation/config';

/** Build a deps mock from fixed fixtures. */
function makeDeps(over: Partial<InterestProfileDeps> = {}): InterestProfileDeps {
  const deps: InterestProfileDeps = {
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
    extractKeywordsBatch: async ({ titles }) =>
      titles.map((title) => {
        if (title.includes('AI')) return { title, keywords: ['ai 논문'], learning_score: 0.9 };
        if (title.includes('주식')) return { title, keywords: ['주식 투자'], learning_score: 0.8 };
        if (title.includes('ETF')) return { title, keywords: ['etf 투자'], learning_score: 0.85 };
        return { title, keywords: ['잡담'], learning_score: 0.1 }; // below floor
      }),
    ...over,
  };
  return deps;
}

describe('mapKeywordToDomain', () => {
  it('maps AI/ML, investment, career, and defaults to other', () => {
    expect(mapKeywordToDomain('Claude 모델')).toBe('ai_ml');
    expect(mapKeywordToDomain('ai 논문')).toBe('ai_ml');
    expect(mapKeywordToDomain('ETF 투자')).toBe('investment');
    expect(mapKeywordToDomain('면접 준비')).toBe('career');
    expect(mapKeywordToDomain('바이올린 연주')).toBe('other');
  });
});

describe('collectAccountSignals', () => {
  it('tags saved videos with save weight and subs with sub weight', async () => {
    const signals = await collectAccountSignals('u1', makeDeps());
    // subscription channel title → sub weight
    expect(signals.titleWeights.get('Two Minute Papers — AI 논문')).toBe(INTEREST_WEIGHTS.sub);
    // saved video title → save weight (stronger)
    expect(signals.titleWeights.get('ETF 배당 투자 전략')).toBe(INTEREST_WEIGHTS.save);
    expect(signals.counts.savedVideos).toBe(1);
  });
});

describe('buildInterestProfile', () => {
  it('produces a normalized, domain-tagged profile; saved-video keyword outranks sub', async () => {
    const profile = await buildInterestProfile('u1', makeDeps());
    const kws = profile.map((p) => p.kw);
    expect(kws).toContain('ai 논문');
    expect(kws).toContain('etf 투자');

    // normalization: top weight is exactly 1.0
    expect(Math.max(...profile.map((p) => p.weight))).toBe(1);

    // domain tagging
    const etf = profile.find((p) => p.kw === 'etf 투자');
    expect(etf?.domain).toBe('investment');
    const ai = profile.find((p) => p.kw === 'ai 논문');
    expect(ai?.domain).toBe('ai_ml');

    // saved-video (save weight 0.6) keyword outranks subscription (sub weight 0.4) keyword
    const aiW = ai!.weight;
    const etfW = etf!.weight;
    expect(etfW).toBeGreaterThan(aiW);
  });

  it('drops keywords below the learning floor', async () => {
    const deps = makeDeps({
      getUserSubscriptions: async () =>
        ({
          items: [{ channelId: 'c', title: '먹방 브이로그', description: '' }],
          totalResults: 1,
        }) as any,
      getUserPlaylists: async () => ({ items: [], totalResults: 0 }) as any,
      getVideosMetadata: async () => [] as any,
      extractKeywordsBatch: async ({ titles }) =>
        titles.map((title) => ({
          title,
          keywords: ['잡담'],
          learning_score: KEYWORD_LEARNING_FLOOR - 0.1,
        })),
    });
    const profile = await buildInterestProfile('u1', deps);
    expect(profile).toHaveLength(0);
  });
});
