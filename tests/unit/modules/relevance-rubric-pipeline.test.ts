/**
 * CP499+ score pipeline — R1 rubric + volatile-only recency + lang 정합.
 *
 * Locks the pipeline invariants:
 *   - composition is CODE-side (weights are PROVISIONAL gate targets);
 *   - recency bonus fires ONLY for volatile + known published_at (additive,
 *     never a penalty; evergreen / NULL volatility / NULL date = 0);
 *   - rubric prompt actually swaps the mandala_fit block (guards against a
 *     silent .replace no-op on template drift) and the legacy prompt is
 *     byte-identical to pre-CP499+ output;
 *   - validator parses both shapes and composes in rubric mode;
 *   - merged-gen prompt asks the volatility judgement in BOTH languages.
 */

import {
  composeRubricScore,
  recencyBonus,
  applyRecency,
  RECENCY_FRESH_BONUS,
  RECENCY_MID_BONUS,
} from '@/modules/relevance/relevance-composition';
import {
  buildV2QuickPrompt,
  validateV2Quick,
  V2QuickValidationError,
} from '@/modules/skills/rich-summary-v2-quick-prompt';
import { buildMandalaWithQueriesPrompt } from '@/prompts/mandala-with-queries-generator';
import { loadRelevanceRubricConfig } from '@/config/relevance-rubric';

describe('composeRubricScore (PROVISIONAL weights — gate-validation targets)', () => {
  it('weights 0.4/0.4/0.2 with a cell goal', () => {
    expect(
      composeRubricScore({ cellFitPct: 100, goalContributionPct: 100, actionabilityPct: 100 })
    ).toBe(100);
    expect(
      composeRubricScore({ cellFitPct: 50, goalContributionPct: 100, actionabilityPct: 0 })
    ).toBe(60);
    expect(
      composeRubricScore({ cellFitPct: 80, goalContributionPct: 70, actionabilityPct: 30 })
    ).toBe(66);
  });

  it('weights 0.7/0.3 without a cell goal', () => {
    expect(
      composeRubricScore({ cellFitPct: null, goalContributionPct: 100, actionabilityPct: 0 })
    ).toBe(70);
    expect(
      composeRubricScore({ cellFitPct: null, goalContributionPct: 80, actionabilityPct: 40 })
    ).toBe(68);
  });

  it('rounds and clamps to [0, 100]', () => {
    expect(composeRubricScore({ cellFitPct: 0, goalContributionPct: 0, actionabilityPct: 0 })).toBe(
      0
    );
    expect(
      composeRubricScore({ cellFitPct: 33, goalContributionPct: 33, actionabilityPct: 33 })
    ).toBe(33);
  });
});

describe('recencyBonus (volatile-only, additive)', () => {
  const now = new Date('2026-06-11T00:00:00Z');
  const monthsAgo = (m: number) => new Date(now.getTime() - m * 30.44 * 24 * 3600 * 1000);

  it('volatile + fresh (<6m) → +5', () => {
    expect(recencyBonus(monthsAgo(5), 'volatile', now)).toBe(RECENCY_FRESH_BONUS);
  });
  it('volatile + mid (6-12m) → +2', () => {
    expect(recencyBonus(monthsAgo(11), 'volatile', now)).toBe(RECENCY_MID_BONUS);
  });
  it('volatile + old (>12m) → 0', () => {
    expect(recencyBonus(monthsAgo(13), 'volatile', now)).toBe(0);
  });
  it('evergreen / NULL volatility / NULL published_at → 0 (unchanged behavior)', () => {
    expect(recencyBonus(monthsAgo(1), 'evergreen', now)).toBe(0);
    expect(recencyBonus(monthsAgo(1), null, now)).toBe(0);
    expect(recencyBonus(null, 'volatile', now)).toBe(0);
  });
  it('future-dated (premiere) counts as fresh', () => {
    expect(recencyBonus(monthsAgo(-1), 'volatile', now)).toBe(RECENCY_FRESH_BONUS);
  });
  it('applyRecency caps at 100', () => {
    expect(applyRecency(98, 5)).toBe(100);
    expect(applyRecency(60, 2)).toBe(62);
  });
});

describe('buildV2QuickPrompt rubric variant', () => {
  const base = {
    title: '테스트 영상',
    description: 'desc',
    channel: 'ch',
    language: 'ko' as const,
    transcript: '',
    mandalaCenterGoal: '바이브 코딩 마스터하기',
  };

  it('rubric prompt swaps the mandala_fit block (guard vs silent replace no-op)', () => {
    const p = buildV2QuickPrompt({ ...base, rubric: true, cellGoal: '환경 구축' });
    expect(p).toContain('cell_fit_pct');
    expect(p).toContain('goal_contribution_pct');
    expect(p).toContain('actionability_pct');
    expect(p).not.toContain('mandala_relevance_pct');
    expect(p).toContain('CELL GOAL: 환경 구축');
  });

  it('rubric without cellGoal prints "(none)"', () => {
    const p = buildV2QuickPrompt({ ...base, rubric: true });
    expect(p).toContain('CELL GOAL: (none)');
  });

  it('legacy prompt (rubric absent) is byte-identical to pre-CP499+ (no rubric tokens)', () => {
    const p = buildV2QuickPrompt(base);
    expect(p).toContain('mandala_relevance_pct');
    expect(p).not.toContain('cell_fit_pct');
    expect(p).not.toContain('CELL GOAL');
  });
});

describe('validateV2Quick rubric mode', () => {
  const body = (fit: Record<string, unknown>) => ({
    core: { one_liner: '바이브 코딩 핵심' },
    analysis: { core_argument: '핵심 주장이다.', mandala_fit: fit },
  });

  it('composes mandala_relevance_pct from the 3 axes', () => {
    const r = validateV2Quick(
      body({ cell_fit_pct: 80, goal_contribution_pct: 70, actionability_pct: 30 }),
      { rubric: true }
    );
    expect(r.analysis.mandala_fit.mandala_relevance_pct).toBe(66);
    expect(r.analysis.mandala_fit.rubric).toEqual({
      cell_fit_pct: 80,
      goal_contribution_pct: 70,
      actionability_pct: 30,
    });
  });

  it('null cell_fit_pct → NO_CELL weights', () => {
    const r = validateV2Quick(
      body({ cell_fit_pct: null, goal_contribution_pct: 100, actionability_pct: 0 }),
      { rubric: true }
    );
    expect(r.analysis.mandala_fit.mandala_relevance_pct).toBe(70);
  });

  it('rubric mode rejects a missing axis', () => {
    expect(() =>
      validateV2Quick(body({ cell_fit_pct: 80, goal_contribution_pct: 70 }), { rubric: true })
    ).toThrow(V2QuickValidationError);
  });

  it('legacy mode is unchanged (single axis, no rubric field)', () => {
    const r = validateV2Quick(body({ mandala_relevance_pct: 85 }));
    expect(r.analysis.mandala_fit.mandala_relevance_pct).toBe(85);
    expect(r.analysis.mandala_fit.rubric).toBeUndefined();
  });
});

describe('merged-gen prompt volatility judgement', () => {
  it('ko prompt asks volatility and the JSON schema carries the key', () => {
    const p = buildMandalaWithQueriesPrompt({ goal: '목표', domain: 'general', language: 'ko' });
    expect(p).toContain('"volatility":"volatile|evergreen"');
    expect(p).toContain('도메인 휘발성');
  });
  it('en prompt asks volatility and the JSON schema carries the key', () => {
    const p = buildMandalaWithQueriesPrompt({ goal: 'goal', domain: 'general', language: 'en' });
    expect(p).toContain('"volatility":"volatile|evergreen"');
    expect(p).toContain('domain volatility');
  });
});

describe('loadRelevanceRubricConfig', () => {
  it('default OFF (unset = legacy pipeline)', () => {
    expect(loadRelevanceRubricConfig({} as NodeJS.ProcessEnv).enabled).toBe(false);
  });
  it('true/1/yes enable; anything else off', () => {
    expect(
      loadRelevanceRubricConfig({ RELEVANCE_RUBRIC_ENABLED: 'true' } as NodeJS.ProcessEnv).enabled
    ).toBe(true);
    expect(
      loadRelevanceRubricConfig({ RELEVANCE_RUBRIC_ENABLED: '1' } as NodeJS.ProcessEnv).enabled
    ).toBe(true);
    expect(
      loadRelevanceRubricConfig({ RELEVANCE_RUBRIC_ENABLED: 'false' } as NodeJS.ProcessEnv).enabled
    ).toBe(false);
    expect(
      loadRelevanceRubricConfig({ RELEVANCE_RUBRIC_ENABLED: 'garbage' } as NodeJS.ProcessEnv)
        .enabled
    ).toBe(false);
  });
});
