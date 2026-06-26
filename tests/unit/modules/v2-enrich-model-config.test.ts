import { loadRichSummaryConfig } from '@/config/rich-summary';
import { calculateCost } from '@/config/llm-pricing';

describe('v2 enrich model config (CP504)', () => {
  it('defaults enrichModel to Sonnet (unset env = prior behaviour)', () => {
    expect(loadRichSummaryConfig({}).enrichModel).toBe('anthropic/claude-sonnet-4-6');
  });
  it('reads RICH_SUMMARY_V2_MODEL override', () => {
    expect(
      loadRichSummaryConfig({ RICH_SUMMARY_V2_MODEL: 'deepseek/deepseek-v4-flash' }).enrichModel
    ).toBe('deepseek/deepseek-v4-flash');
  });
  it('prices DeepSeek V4-Flash (normalized id) so cost_usd is not NULL', () => {
    const c = calculateCost('openrouter/deepseek/deepseek-v4-flash', 10000, 5000);
    expect(c).not.toBeNull();
    // in 10000×$0.14/M + out 5000×$0.28/M = 0.0014 + 0.0014 = 0.0028
    expect(c).toBeCloseTo(0.0028, 5);
  });
});
