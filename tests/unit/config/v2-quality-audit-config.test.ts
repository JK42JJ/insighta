/**
 * Unit tests for v2-quality-audit config loader (CP488+ Phase 1 + Phase 3).
 *
 * Verifies the zod schema defaults + env overrides for both the audit
 * cron knobs and the Phase 3 regen worker knobs so a future env-name
 * typo or default drift surfaces at the unit level.
 */

import { loadV2QualityAuditConfig } from '@/config/v2-quality-audit';

describe('loadV2QualityAuditConfig', () => {
  describe('defaults (empty env)', () => {
    it('returns the Phase 1 + Phase 3 defaults', () => {
      const cfg = loadV2QualityAuditConfig({});
      expect(cfg.enabled).toBe(false);
      expect(cfg.cronSchedule).toBe('0 4 * * *');
      expect(cfg.passScore).toBe(85);
      expect(cfg.warningScore).toBe(70);
      expect(cfg.scanLimit).toBe(5000);
      expect(cfg.regenBatchSize).toBe(5);
      expect(cfg.regenEnabled).toBe(false);
      expect(cfg.regenCronSchedule).toBe('*/30 * * * *');
      expect(cfg.smokeEnabled).toBe(false);
    });
  });

  describe('env overrides', () => {
    it('parses truthy bool flags', () => {
      const cfg = loadV2QualityAuditConfig({
        V2_QUALITY_AUDIT_ENABLED: 'true',
        V2_QUALITY_REGEN_ENABLED: '1',
        V2_QUALITY_AUDIT_SMOKE_ENABLED: 'yes',
      });
      expect(cfg.enabled).toBe(true);
      expect(cfg.regenEnabled).toBe(true);
      expect(cfg.smokeEnabled).toBe(true);
    });

    it('accepts positive integer overrides', () => {
      const cfg = loadV2QualityAuditConfig({
        V2_QUALITY_AUDIT_PASS_SCORE: '90',
        V2_QUALITY_AUDIT_WARNING_SCORE: '75',
        V2_QUALITY_AUDIT_SCAN_LIMIT: '2000',
        V2_QUALITY_AUDIT_REGEN_BATCH_SIZE: '20',
      });
      expect(cfg.passScore).toBe(90);
      expect(cfg.warningScore).toBe(75);
      expect(cfg.scanLimit).toBe(2000);
      expect(cfg.regenBatchSize).toBe(20);
    });

    it('accepts custom cron schedules', () => {
      const cfg = loadV2QualityAuditConfig({
        V2_QUALITY_AUDIT_CRON_SCHEDULE: '0 0 * * *',
        V2_QUALITY_REGEN_CRON_SCHEDULE: '*/15 * * * *',
      });
      expect(cfg.cronSchedule).toBe('0 0 * * *');
      expect(cfg.regenCronSchedule).toBe('*/15 * * * *');
    });

    it('falls back to defaults on bad values', () => {
      const cfg = loadV2QualityAuditConfig({
        V2_QUALITY_AUDIT_PASS_SCORE: 'garbage',
        V2_QUALITY_AUDIT_REGEN_BATCH_SIZE: '-1',
      });
      // Schema returns FALLBACK_CONFIG on parse failure (any field bad → whole reset).
      expect(cfg.passScore).toBe(85);
      expect(cfg.regenBatchSize).toBe(5);
    });
  });
});
