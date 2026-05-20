/**
 * CP476+ — validateV2Quick + trimOneLinerLabel: sidebar label sanity.
 *
 * Background: prod sampling found 1 row out of ~80 where the LLM ignored
 * the "≤ 20 characters" prompt rule and emitted a full 51-char sentence.
 * Rather than fail the quick path entirely on these outliers, the
 * validator now soft-truncates the label so the sidebar renders cleanly.
 */
import {
  trimOneLinerLabel,
  validateV2Quick,
  V2QuickValidationError,
} from '@/modules/skills/rich-summary-v2-quick-prompt';

describe('trimOneLinerLabel — CP476+ sidebar hard cap', () => {
  it('passes through a compliant short label unchanged', () => {
    expect(trimOneLinerLabel('월배당 ETF 전략')).toBe('월배당 ETF 전략');
  });

  it('truncates a 51-char sentence to 20 chars (no mid-word ellipsis)', () => {
    const long = '미국 10대 부자들이 SNS, 리셀, AI SaaS, 드롭쉬핑+코인으로 돈 버는 4가지 방식';
    const out = trimOneLinerLabel(long);
    expect(out.length).toBeLessThanOrEqual(20);
    expect(out.startsWith('미국 10대 부자들이')).toBe(true);
  });

  it('strips trailing punctuation after truncation', () => {
    expect(trimOneLinerLabel('ETF 전략을 알아보자.')).not.toMatch(/[.!?,;:、。…]$/);
    expect(trimOneLinerLabel('ETF 전략을 알아보자,')).not.toMatch(/[.!?,;:、。…]$/);
  });

  it('handles full sentence with trailing comma after truncation', () => {
    // After truncation a comma can end up at position 20 — must strip.
    const out = trimOneLinerLabel(
      '하나, 둘, 셋, 넷, 다섯, 여섯, 일곱, 여덟, 아홉, 열' // commas everywhere
    );
    expect(out).not.toMatch(/[,\s]$/);
    expect(out.length).toBeLessThanOrEqual(20);
  });

  it('trims leading/trailing whitespace', () => {
    expect(trimOneLinerLabel('   ETF 전략   ')).toBe('ETF 전략');
  });
});

describe('validateV2Quick — quick path schema', () => {
  const validRaw = {
    core: { one_liner: '월배당 ETF 전략' },
    analysis: {
      core_argument: '월배당 ETF 는 안정적 현금흐름을 제공한다.',
      mandala_fit: { mandala_relevance_pct: 85 },
    },
  };

  it('returns parsed result on compliant input', () => {
    const out = validateV2Quick(validRaw);
    expect(out.core.one_liner).toBe('월배당 ETF 전략');
    expect(out.analysis.mandala_fit.mandala_relevance_pct).toBe(85);
  });

  it('truncates over-long one_liner instead of rejecting', () => {
    const raw = {
      ...validRaw,
      core: { one_liner: '미국 10대 부자들이 SNS, 리셀, AI SaaS 로 돈 버는 4가지 방식' },
    };
    const out = validateV2Quick(raw);
    expect(out.core.one_liner.length).toBeLessThanOrEqual(20);
  });

  it('rejects when one_liner exceeds the hard raw cap (200 chars)', () => {
    const raw = {
      ...validRaw,
      core: { one_liner: '가'.repeat(250) },
    };
    expect(() => validateV2Quick(raw)).toThrow(V2QuickValidationError);
  });

  it('rejects empty one_liner', () => {
    const raw = { ...validRaw, core: { one_liner: '' } };
    expect(() => validateV2Quick(raw)).toThrow(V2QuickValidationError);
  });
});
