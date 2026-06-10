/**
 * CP499+ '영문 카드 포함' toggle — 3-way contract (James spec):
 *   ① ko + ON  → EN titles pass the gate; third-script stays blocked;
 *                the live search drops the relevanceLanguage=ko bias
 *   ② ko + OFF → current single-language gate, bit-identical
 *   ③ en mandala → toggle is a no-op (en rules regardless of the flag)
 *
 * Honest note pinned in code: the ko-rules ALREADY pass pure-Latin titles —
 * the toggle's EN-inflow body is the relevanceLanguage drop (the pool is
 * 5.9% EN, live search is the supply body). The gate-widening keeps the
 * semantics explicit.
 */
import {
  isOffLanguageTitle,
  isOffLanguageTitleToggled,
} from '../../../../src/skills/plugins/video-discover/v5/youtube-fanout';

const KO = '농구 드리블 기본기 강좌';
const EN = 'Basketball Dribbling Fundamentals';
const ZH = '篮球运球基础教程完整版'; // third-script: blocked in every mode
const AR = 'أساسيات المراوغة في كرة السلة';

describe("'영문 카드 포함' — off-language gate 3-way", () => {
  it('① ko + ON: ko and EN pass; third-script (zh/ar) stays blocked', () => {
    // Design finding pinned: the ko gate is already EN-permissive, and a
    // ko∪en union would re-admit Arabic/Thai (the en-rules only block CJK).
    // So ON keeps the ko gate; EN-inflow comes from the relevanceLanguage
    // drop in the search call.
    expect(isOffLanguageTitleToggled(KO, 'ko', true)).toBe(false);
    expect(isOffLanguageTitleToggled(EN, 'ko', true)).toBe(false);
    expect(isOffLanguageTitleToggled(ZH, 'ko', true)).toBe(true);
    expect(isOffLanguageTitleToggled(AR, 'ko', true)).toBe(true);
  });

  it('② ko + OFF (and undefined): bit-identical to the current ko gate', () => {
    for (const t of [KO, EN, ZH, AR]) {
      expect(isOffLanguageTitleToggled(t, 'ko', false)).toBe(isOffLanguageTitle(t, 'ko'));
      expect(isOffLanguageTitleToggled(t, 'ko', undefined)).toBe(isOffLanguageTitle(t, 'ko'));
    }
  });

  it('③ en mandala: the flag is a no-op — en rules apply regardless', () => {
    for (const t of [KO, EN, ZH]) {
      expect(isOffLanguageTitleToggled(t, 'en', true)).toBe(isOffLanguageTitle(t, 'en'));
      expect(isOffLanguageTitleToggled(t, 'en', false)).toBe(isOffLanguageTitle(t, 'en'));
    }
  });
});
