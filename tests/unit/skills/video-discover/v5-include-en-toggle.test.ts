/**
 * CP499+ '영문 카드 포함' toggle — 3-way contract, UPDATED for UX 원칙 1
 * (언어 일관성, James 2026-06-11):
 *   ① ko + ON  → EN titles pass the gate (opt-in wants English);
 *                third-script stays blocked
 *   ② ko + OFF → English-DOMINANT titles are now DROPPED (spec change —
 *                the prior "EN-passes invariant" was re-judged a product
 *                defect on K8s-mandala screen evidence). Hangul-bearing
 *                titles keep passing (Korean video with English terms).
 *   ③ en mandala → toggle is a no-op (en rules regardless of the flag)
 *   ④ V5_KO_EN_TITLE_DROP=false → legacy English-passes behavior (rollback
 *                lever, config-only).
 *
 * Signal = #902 detectLanguage: ANY Hangul ⇒ ko ⇒ kept; zero Hangul +
 * Latin ⇒ en ⇒ dropped.
 */
import {
  isOffLanguageTitle,
  isOffLanguageTitleToggled,
} from '../../../../src/skills/plugins/video-discover/v5/youtube-fanout';

const KO = '농구 드리블 기본기 강좌';
const EN = 'Basketball Dribbling Fundamentals';
const ZH = '篮球运球基础教程完整版'; // third-script: blocked in every mode
const AR = 'أساسيات المراوغة في كرة السلة';

// 2026-06-11 K8s-mandala screen regression set (the exact production cases).
const SCREEN_EN_DOMINANT = [
  'Kubernetes Monitoring with Prometheus & Grafana Using Helm | Complete Hands-On Demo',
  'Container Security Explained Kubernetes, Docker & Cloud Native Threats',
  'Kubernetes Security: Performance, Hardening, and Lifecycle Management | Uplatz',
];
const SCREEN_KO_WITH_TERMS = [
  '[용어](Cybersecurity) Kubernetes Security - 쿠버네티스 보안',
  'Kubernetes란? For Real Begginer',
];

describe("'영문 카드 포함' — off-language gate 3-way (UX 원칙 1)", () => {
  it('① ko + ON: ko and EN pass (opt-in); third-script (zh/ar) stays blocked', () => {
    expect(isOffLanguageTitleToggled(KO, 'ko', true)).toBe(false);
    expect(isOffLanguageTitleToggled(EN, 'ko', true)).toBe(false);
    expect(isOffLanguageTitleToggled(ZH, 'ko', true)).toBe(true);
    expect(isOffLanguageTitleToggled(AR, 'ko', true)).toBe(true);
  });

  it('② ko + OFF (and undefined): English-dominant DROPPED, Hangul-bearing kept (spec change)', () => {
    for (const off of [false, undefined] as const) {
      expect(isOffLanguageTitleToggled(KO, 'ko', off)).toBe(false);
      expect(isOffLanguageTitleToggled(EN, 'ko', off)).toBe(true); // was false pre-UX원칙1
      expect(isOffLanguageTitleToggled(ZH, 'ko', off)).toBe(true);
      expect(isOffLanguageTitleToggled(AR, 'ko', off)).toBe(true);
    }
  });

  it('② regression — the 5 production K8s-screen cases (2026-06-11)', () => {
    for (const t of SCREEN_EN_DOMINANT) {
      expect(isOffLanguageTitleToggled(t, 'ko', false)).toBe(true);
    }
    for (const t of SCREEN_KO_WITH_TERMS) {
      expect(isOffLanguageTitleToggled(t, 'ko', false)).toBe(false);
    }
    // and the EN chip keeps them (opt-in unaffected):
    for (const t of SCREEN_EN_DOMINANT) {
      expect(isOffLanguageTitleToggled(t, 'ko', true)).toBe(false);
    }
  });

  it('② edge: digits/symbols-only title falls back ko → kept (conservative)', () => {
    expect(isOffLanguageTitleToggled('2026 — 100%', 'ko', false)).toBe(false);
  });

  it('③ en mandala: the flag is a no-op — en rules apply regardless', () => {
    for (const t of [KO, EN, ZH]) {
      expect(isOffLanguageTitleToggled(t, 'en', true)).toBe(isOffLanguageTitle(t, 'en'));
      expect(isOffLanguageTitleToggled(t, 'en', false)).toBe(isOffLanguageTitle(t, 'en'));
    }
  });

  it('④ V5_KO_EN_TITLE_DROP=false (4th arg) → legacy English-passes behavior', () => {
    expect(isOffLanguageTitleToggled(EN, 'ko', false, false)).toBe(false);
    for (const t of SCREEN_EN_DOMINANT) {
      expect(isOffLanguageTitleToggled(t, 'ko', false, false)).toBe(false);
    }
    // third-script rules unaffected by the lever
    expect(isOffLanguageTitleToggled(ZH, 'ko', false, false)).toBe(true);
  });
});
