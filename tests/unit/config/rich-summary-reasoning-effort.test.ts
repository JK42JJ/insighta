import { loadRichSummaryConfig } from '../../../src/config/rich-summary';

describe('RICH_SUMMARY_V2_REASONING_EFFORT', () => {
  it('is unset by default, so the model keeps its own default', () => {
    expect(loadRichSummaryConfig({}).reasoningEffort).toBeUndefined();
  });

  it('reads a valid value, ignoring case and spaces', () => {
    expect(
      loadRichSummaryConfig({ RICH_SUMMARY_V2_REASONING_EFFORT: '  LOW ' }).reasoningEffort
    ).toBe('low');
    expect(
      loadRichSummaryConfig({ RICH_SUMMARY_V2_REASONING_EFFORT: 'none' }).reasoningEffort
    ).toBe('none');
  });

  it('treats an empty value as unset', () => {
    expect(
      loadRichSummaryConfig({ RICH_SUMMARY_V2_REASONING_EFFORT: '' }).reasoningEffort
    ).toBeUndefined();
  });

  it('ignores an unrecognised value without discarding the rest of the config', () => {
    const cfg = loadRichSummaryConfig({
      RICH_SUMMARY_V2_REASONING_EFFORT: 'bogus',
      RICH_SUMMARY_V2_MODEL: 'deepseek/deepseek-v4-flash',
      RICH_SUMMARY_V2_MAX_OUTPUT_TOKENS: '4096',
    });
    expect(cfg.reasoningEffort).toBeUndefined();
    expect(cfg.enrichModel).toBe('deepseek/deepseek-v4-flash');
    expect(cfg.maxOutputTokens).toBe(4096);
  });
});
