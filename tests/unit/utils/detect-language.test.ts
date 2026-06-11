/**
 * detect-language — script detection for goal/title text (CP458, CP499+).
 *
 * Pins two fixes:
 * - CP458: an English goal must resolve to 'en' so YouTube search uses
 *   regionCode=US + relevanceLanguage=en instead of the NULL→'ko' default.
 * - CP499+ (diagnosis A-3): Hangul PRESENCE wins outright — Latin proper
 *   nouns must not outvote Korean particles. Regression cases below are the
 *   exact 3 misjudged production goals (full-fleet scan 2026-06-11:
 *   3 en-misjudged corrected, 0 reverse flips).
 */

import { detectLanguage, resolveLanguage } from '@/utils/detect-language';

describe('detectLanguage', () => {
  it('detects an English goal as en (the CP458 bug case)', () => {
    expect(detectLanguage('Build retirement assets via ETF investing')).toBe('en');
  });

  it('detects a Korean goal as ko', () => {
    expect(detectLanguage('ETF 투자로 노후 자산 만들기')).toBe('ko');
  });

  it('treats Korean-dominant mixed text as ko', () => {
    expect(detectLanguage('AI 마케팅으로 비즈니스 성장 시키기')).toBe('ko');
  });

  it('CP499+ — ANY Hangul wins even when Latin letters dominate (proper nouns excluded)', () => {
    // Spec change vs CP458: previously latin-count > hangul-count → 'en'.
    expect(detectLanguage('Complete an AI/ML project portfolio 만들기')).toBe('ko');
  });

  it('CP499+ regression — the 3 real misjudged production goals are ko', () => {
    expect(detectLanguage('Claude Code로 프로덕션 앱 개발')).toBe('ko');
    expect(detectLanguage('Ultra Learning 으로 AI 전문가 되기')).toBe('ko');
    expect(detectLanguage('gitthub 공부')).toBe('ko');
  });

  it('pure-Latin text still detects as en (no reverse flip)', () => {
    expect(detectLanguage('Master Kubernetes in 30 days')).toBe('en');
    expect(detectLanguage('Claude Code')).toBe('en');
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

  it('CP499+ — NULL stored + mixed proper-noun goal resolves ko via detection', () => {
    expect(resolveLanguage(null, 'Claude Code로 프로덕션 앱 개발')).toBe('ko');
  });
});
