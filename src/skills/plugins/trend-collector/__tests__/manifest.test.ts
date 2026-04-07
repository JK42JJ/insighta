/**
 * trend-collector — manifest contract tests
 *
 * Locks the manifest fields the rest of the system depends on:
 *   - registry-adapter relies on id, version, layer, trigger, tiers
 *   - SkillRegistry quota gates rely on id + tiers
 *   - The plugin architecture's hard rules (frozen, idempotent declared,
 *     tables.write declared) are enforced by validateManifest() at boot —
 *     this test pins the values that satisfy them.
 *
 * If this test fails, do NOT relax the assertions — the manifest is the
 * boundary contract. Either fix the manifest, or migrate the plugin
 * architecture doc first.
 */

import {
  manifest,
  TREND_COLLECTOR_DEFAULT_CATEGORY_IDS,
  TREND_COLLECTOR_DEFAULT_REGION_CODE,
  TREND_COLLECTOR_MAX_RESULTS_PER_CATEGORY,
  TREND_COLLECTOR_TTL_DAYS,
  TREND_COLLECTOR_SOURCE_LLM,
  TREND_COLLECTOR_SOURCE_SUGGEST,
  TREND_COLLECTOR_LEARNING_THRESHOLD,
} from '../manifest';
import { validateManifest } from '@/skills/_shared/runtime';

describe('trend-collector manifest', () => {
  it('passes validateManifest() — boot-time hard rules', () => {
    expect(() => validateManifest(manifest)).not.toThrow();
  });

  it('is Object.freeze()d (immutability hard rule)', () => {
    expect(Object.isFrozen(manifest)).toBe(true);
  });

  it('declares Layer A (in-process cron, no Temporal yet)', () => {
    expect(manifest.layer).toBe('A');
  });

  it('uses kebab-case id and matches the directory name', () => {
    expect(manifest.id).toBe('trend-collector');
  });

  it('declares idempotent=true (upsert by source+keyword+language)', () => {
    expect(manifest.idempotent).toBe(true);
  });

  describe('trigger', () => {
    it('is a nightly cron at 03:00', () => {
      expect(manifest.trigger).toEqual({ type: 'cron', schedule: '0 3 * * *' });
    });
  });

  describe('tables ownership', () => {
    it('writes ONLY to trend_signals (Layer 1 boundary)', () => {
      expect(manifest.tables.write).toEqual(['trend_signals']);
    });

    it('reads from no tables (Phase 1 has no historical comparison)', () => {
      expect(manifest.tables.read).toEqual([]);
    });
  });

  describe('dependencies (Phase 1.5a)', () => {
    it('requires YOUTUBE_API_KEY (hard) and OLLAMA_URL (soft)', () => {
      expect(manifest.dependencies).toBeDefined();
      expect(manifest.dependencies).toHaveLength(2);
      const yt = manifest.dependencies?.find((d) => d.env === 'YOUTUBE_API_KEY');
      const ollama = manifest.dependencies?.find((d) => d.env === 'OLLAMA_URL');
      expect(yt?.required).toBe(true);
      expect(ollama?.required).toBe(false); // soft — degraded mode allowed
    });

    it('does NOT require Naver keys (deferred to Phase 1.5b)', () => {
      const envs = manifest.dependencies?.map((d) => d.env) ?? [];
      expect(envs).not.toContain('NAVER_CLIENT_ID');
      expect(envs).not.toContain('NAVER_CLIENT_SECRET');
    });
  });

  describe('tiers', () => {
    it('is available to every tier (free + pro + lifetime + admin)', () => {
      expect([...manifest.tiers].sort()).toEqual(['admin', 'free', 'lifetime', 'pro'].sort());
    });
  });

  describe('Phase 1 constants', () => {
    it('exports default category IDs covering 5 educational categories', () => {
      expect(TREND_COLLECTOR_DEFAULT_CATEGORY_IDS).toHaveLength(5);
      // Education + Science & Tech + Howto + News + People
      expect(TREND_COLLECTOR_DEFAULT_CATEGORY_IDS).toEqual(
        expect.arrayContaining(['27', '28', '26', '25', '22'])
      );
    });

    it('defaults to KR region', () => {
      expect(TREND_COLLECTOR_DEFAULT_REGION_CODE).toBe('KR');
    });

    it('caps results per category at 10 (quota safety)', () => {
      expect(TREND_COLLECTOR_MAX_RESULTS_PER_CATEGORY).toBe(10);
    });

    it('uses 7-day TTL (aligns with weekly recommendation cycle)', () => {
      expect(TREND_COLLECTOR_TTL_DAYS).toBe(7);
    });

    it('uses Phase 1.5a source identifiers (LLM primary, Suggest secondary)', () => {
      expect(TREND_COLLECTOR_SOURCE_LLM).toBe('youtube_trending_extracted');
      expect(TREND_COLLECTOR_SOURCE_SUGGEST).toBe('youtube_suggest');
    });

    it('learning threshold defaults to 0.3 (drops pure entertainment)', () => {
      expect(TREND_COLLECTOR_LEARNING_THRESHOLD).toBe(0.3);
    });
  });
});
