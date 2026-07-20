/**
 * Curation 3-topic suggestion — pure scorer unit tests (Growth Hub, 2026-07-20).
 * Design: docs/design/growth-hub-curation-personalized-2026-07-20.md (§4).
 *
 * Tests scoreAndSelect directly (no DB/LLM): affinity+rising ranking, domain
 * diversity cap (redundancy guard), reinforcement boost.
 */

import {
  scoreAndSelect,
  type TrendCandidate,
  type ReinforceSignals,
} from '@/modules/curation/suggest';
import type { InterestProfile } from '@/modules/curation/interest-profile';
import type { CurationDomain } from '@/modules/curation/domain-taxonomy';

const emptySignals: ReinforceSignals = { selected: new Map(), unselected: new Map() };

describe('scoreAndSelect', () => {
  it('ranks a profile-matching + rising topic above an unrelated one', () => {
    const profile: InterestProfile = [{ kw: 'claude', domain: 'ai_ml', weight: 1 }];
    const candidates: TrendCandidate[] = [
      { keyword: 'claude 코드', norm_score: 0.9 }, // matches profile + high rising
      { keyword: '바이올린 레슨', norm_score: 0.4 }, // unrelated
    ];
    const out = scoreAndSelect(profile, candidates, emptySignals);
    expect(out).toHaveLength(2);
    expect(out[0]!.topic).toBe('claude 코드');
    expect(out[0]!.domain).toBe('ai_ml');
    expect(out[0]!.score).toBeGreaterThan(out[1]!.score);
  });

  it('enforces the max-per-domain diversity cap (redundancy guard)', () => {
    const profile: InterestProfile = [{ kw: 'ai', domain: 'ai_ml', weight: 1 }];
    // 4 AI topics + 1 investment; cap = 2 per domain → result must include the investment one.
    const candidates: TrendCandidate[] = [
      { keyword: 'ai 뉴스', norm_score: 0.95 },
      { keyword: 'llm 튜토리얼', norm_score: 0.9 },
      { keyword: 'gpt 활용', norm_score: 0.85 },
      { keyword: 'gemini 소식', norm_score: 0.8 },
      { keyword: 'etf 투자', norm_score: 0.5 },
    ];
    const out = scoreAndSelect(profile, candidates, emptySignals);
    expect(out).toHaveLength(3);
    const aiCount = out.filter((p) => p.domain === 'ai_ml').length;
    expect(aiCount).toBeLessThanOrEqual(2);
    expect(out.some((p) => p.domain === 'investment')).toBe(true);
  });

  it('reinforcement boosts a previously selected domain', () => {
    const profile: InterestProfile = [];
    const candidates: TrendCandidate[] = [
      { keyword: '창업 아이디어', norm_score: 0.6 },
      { keyword: '주식 분석', norm_score: 0.6 },
    ];
    const startupSelected: ReinforceSignals = {
      selected: new Map<CurationDomain, number>([['startup', 3]]),
      unselected: new Map(),
    };
    const out = scoreAndSelect(profile, candidates, startupSelected);
    expect(out[0]!.domain).toBe('startup'); // reinforcement tips the equal-rising tie
  });
});
