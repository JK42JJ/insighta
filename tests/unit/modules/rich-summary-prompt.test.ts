/**
 * Rich Summary extended RichSummary type + segments formatting — CP422 P1.
 * Pure unit (no DB, no LLM).
 */

import { checkSummaryQuality, type RichSummary } from '../../../src/modules/skills/summary-gate';

describe('RichSummary extended fields (CP422 P1)', () => {
  const baseline: RichSummary = {
    core_argument: 'Short but valid core argument string',
    key_points: ['a', 'b', 'c'],
    evidence: [],
    actionables: ['do x'],
    prerequisites: [],
    bias_signals: [],
    content_type: 'tutorial',
    depth_level: 'beginner',
    mandala_fit: { suggested_topics: ['k'], relevance_rationale: 'r' },
  };

  it('quality gate still PASS when chapters/quotes/tl_dr are absent (optional fields)', () => {
    const result = checkSummaryQuality(baseline);
    expect(result.passed).toBe(true);
  });

  it('quality gate still PASS with chapters/quotes/tl_dr present', () => {
    const withExt: RichSummary = {
      ...baseline,
      chapters: [
        { start_sec: 0, title: 'Intro' },
        { start_sec: 120, title: 'Body' },
      ],
      quotes: [{ timestamp_sec: 60, text: 'notable line' }],
      tl_dr_ko: '한글 요약 200자 이내',
      tl_dr_en: 'English 200-char summary',
    };
    const result = checkSummaryQuality(withExt);
    expect(result.passed).toBe(true);
  });

  it('type shape accepts empty chapters / quotes arrays', () => {
    const empty: RichSummary = { ...baseline, chapters: [], quotes: [] };
    const result = checkSummaryQuality(empty);
    expect(result.passed).toBe(true);
  });
});
