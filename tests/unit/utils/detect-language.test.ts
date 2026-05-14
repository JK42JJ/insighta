/**
 * detect-language — script detection for goal/title text (CP458).
 *
 * Pins the fix for the English-mandala-searched-as-Korean bug: an English
 * goal must resolve to 'en' so YouTube search uses regionCode=US +
 * relevanceLanguage=en instead of the NULL→'ko' default.
 */

import { detectLanguage, resolveLanguage } from '@/utils/detect-language';

describe('detectLanguage', () => {
  it('detects an English goal as en (the reported bug case)', () => {
    expect(detectLanguage('Build retirement assets via ETF investing')).toBe('en');
  });

  it('detects a Korean goal as ko', () => {
    expect(detectLanguage('ETF 투자로 노후 자산 만들기')).toBe('ko');
  });

  it('treats Korean-dominant mixed text as ko', () => {
    // "AI" is Latin but Hangul dominates → ko
    expect(detectLanguage('AI 마케팅으로 비즈니스 성장 시키기')).toBe('ko');
  });

  it('treats English-dominant mixed text as en', () => {
    expect(detectLanguage('Complete an AI/ML project portfolio 만들기')).toBe('en');
  });

  it('defaults to ko for empty / null / no-script input (preserves pre-CP458 default)', () => {
    expect(detectLanguage('')).toBe('ko');
    expect(detectLanguage(null)).toBe('ko');
    expect(detectLanguage(undefined)).toBe('ko');
    expect(detectLanguage('2026 — 100%')).toBe('ko');
  });
});

describe('resolveLanguage', () => {
  it('a stored ko/en value wins over text detection (input-language priority)', () => {
    expect(resolveLanguage('en', '한국어 제목')).toBe('en');
    expect(resolveLanguage('ko', 'English title')).toBe('ko');
  });

  it('falls through to text detection when stored is NULL', () => {
    expect(resolveLanguage(null, 'Build retirement assets via ETF investing')).toBe('en');
    expect(resolveLanguage(null, 'ETF 투자로 노후 자산')).toBe('ko');
  });

  it('falls through to text detection for empty or stray stored values', () => {
    expect(resolveLanguage('', 'English text')).toBe('en');
    expect(resolveLanguage('EN', '한국어')).toBe('ko'); // case-sensitive — 'EN' is not 'en'
    expect(resolveLanguage('garbage', 'English text')).toBe('en');
  });
});
