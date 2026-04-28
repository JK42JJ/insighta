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
      expect(cfg).toEqual({
        enabled: true,
        captionSource: 'disabled',
        v2CronEnabled: false,
        v2BatchSize: 50,
        v2CronSchedule: '0 17 * * *',
      });
    });

    it('enabled + mac_mini', () => {
      const cfg = loadRichSummaryConfig({
        RICH_SUMMARY_ENABLED: 'true',
        RICH_SUMMARY_CAPTION_SOURCE: 'mac_mini',
      });
      expect(cfg).toEqual({
        enabled: true,
        captionSource: 'mac_mini',
        v2CronEnabled: false,
        v2BatchSize: 50,
        v2CronSchedule: '0 17 * * *',
      });
    });
  });

  describe('v2 cron flags (CP437)', () => {
    it.each([
      ['true', true],
      ['1', true],
      ['yes', true],
      ['false', false],
      ['', false],
      ['unset', false],
    ])('RICH_SUMMARY_V2_CRON_ENABLED=%s → %s', (raw, expected) => {
      const env = raw === 'unset' ? {} : { RICH_SUMMARY_V2_CRON_ENABLED: raw };
      expect(loadRichSummaryConfig(env).v2CronEnabled).toBe(expected);
    });

    it('RICH_SUMMARY_V2_BATCH_SIZE accepts positive integer', () => {
      expect(loadRichSummaryConfig({ RICH_SUMMARY_V2_BATCH_SIZE: '20' }).v2BatchSize).toBe(20);
      expect(loadRichSummaryConfig({ RICH_SUMMARY_V2_BATCH_SIZE: '100' }).v2BatchSize).toBe(100);
    });

    it('invalid V2_BATCH_SIZE → fallback default 50', () => {
      expect(loadRichSummaryConfig({ RICH_SUMMARY_V2_BATCH_SIZE: '0' }).v2BatchSize).toBe(50);
      expect(loadRichSummaryConfig({ RICH_SUMMARY_V2_BATCH_SIZE: '-3' }).v2BatchSize).toBe(50);
      expect(loadRichSummaryConfig({ RICH_SUMMARY_V2_BATCH_SIZE: 'garbage' }).v2BatchSize).toBe(50);
    });

    it('V2_CRON_SCHEDULE custom value passes through', () => {
      const cfg = loadRichSummaryConfig({ RICH_SUMMARY_V2_CRON_SCHEDULE: '*/15 * * * *' });
      expect(cfg.v2CronSchedule).toBe('*/15 * * * *');
    });

    it('V2_CRON_SCHEDULE empty falls back to 0 17 * * *', () => {
      expect(loadRichSummaryConfig({}).v2CronSchedule).toBe('0 17 * * *');
      expect(loadRichSummaryConfig({ RICH_SUMMARY_V2_CRON_SCHEDULE: '' }).v2CronSchedule).toBe(
        '0 17 * * *'
      );
    });
  });
});
