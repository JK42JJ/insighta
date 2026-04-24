/**
 * Rich Summary config unit tests — CP422 P1.
 * Validates feature flag parsing + defaults.
 */

import { loadRichSummaryConfig } from '../../../src/config/rich-summary';

describe('loadRichSummaryConfig', () => {
  describe('defaults (unset env)', () => {
    it('returns {enabled:false, captionSource:disabled}', () => {
      const cfg = loadRichSummaryConfig({});
      expect(cfg.enabled).toBe(false);
      expect(cfg.captionSource).toBe('disabled');
    });
  });

  describe('enabled flag parsing', () => {
    it.each([
      ['true', true],
      ['TRUE', true],
      ['1', true],
      ['yes', true],
      [' TRUE ', true],
      ['false', false],
      ['0', false],
      ['', false],
      ['anything', false],
    ])('RICH_SUMMARY_ENABLED=%s → enabled=%s', (raw, expected) => {
      const cfg = loadRichSummaryConfig({ RICH_SUMMARY_ENABLED: raw });
      expect(cfg.enabled).toBe(expected);
    });
  });

  describe('captionSource enum', () => {
    it.each([
      ['disabled', 'disabled'],
      ['mac_mini', 'mac_mini'],
      ['prod_direct', 'prod_direct'],
      ['MAC_MINI', 'mac_mini'],
      [' PROD_DIRECT ', 'prod_direct'],
    ])('source=%s → %s', (raw, expected) => {
      const cfg = loadRichSummaryConfig({ RICH_SUMMARY_CAPTION_SOURCE: raw });
      expect(cfg.captionSource).toBe(expected);
    });

    it('falls back to disabled when invalid enum value', () => {
      const cfg = loadRichSummaryConfig({ RICH_SUMMARY_CAPTION_SOURCE: 'bogus' });
      expect(cfg.captionSource).toBe('disabled');
    });

    it('falls back to disabled when missing', () => {
      const cfg = loadRichSummaryConfig({});
      expect(cfg.captionSource).toBe('disabled');
    });
  });

  describe('combined (production-realistic)', () => {
    it('enabled + disabled source', () => {
      const cfg = loadRichSummaryConfig({
        RICH_SUMMARY_ENABLED: 'true',
        RICH_SUMMARY_CAPTION_SOURCE: 'disabled',
      });
      expect(cfg).toEqual({ enabled: true, captionSource: 'disabled' });
    });

    it('enabled + mac_mini', () => {
      const cfg = loadRichSummaryConfig({
        RICH_SUMMARY_ENABLED: 'true',
        RICH_SUMMARY_CAPTION_SOURCE: 'mac_mini',
      });
      expect(cfg).toEqual({ enabled: true, captionSource: 'mac_mini' });
    });
  });
});
