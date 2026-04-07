/**
 * iks-scorer — manifest contract tests
 *
 * Pins manifest fields the rest of the system depends on:
 *   - registry-adapter: id, version, layer, trigger, tiers
 *   - validateManifest hard rules: frozen, idempotent, kebab-case id
 *   - tables ownership: reads {trend_signals, scoring_weights}, writes {keyword_scores}
 *
 * If this test fails, do NOT relax the assertions — manifest is the contract
 * boundary. Fix the manifest or migrate the architecture doc first.
 */

import { manifest, IKS_SCORER_DEFAULT_SOURCES, IKS_SCORER_TTL_DAYS } from '../manifest';
import { validateManifest } from '@/skills/_shared/runtime';

describe('iks-scorer manifest', () => {
  it('passes validateManifest() — boot-time hard rules', () => {
    expect(() => validateManifest(manifest)).not.toThrow();
  });

  it('is Object.freeze()d (immutability hard rule)', () => {
    expect(Object.isFrozen(manifest)).toBe(true);
  });

  it('uses kebab-case id matching the directory name', () => {
    expect(manifest.id).toBe('iks-scorer');
  });

  it('declares Layer A (in-process, no Temporal yet)', () => {
    expect(manifest.layer).toBe('A');
  });

  it('declares idempotent=true (upsert by keyword+language)', () => {
    expect(manifest.idempotent).toBe(true);
  });

  describe('trigger', () => {
    it('runs nightly 15 min after trend-collector', () => {
      expect(manifest.trigger).toEqual({ type: 'cron', schedule: '15 3 * * *' });
    });
  });

  describe('table ownership', () => {
    it('reads trend_signals + scoring_weights + mandala_embeddings (Phase 2b)', () => {
      expect([...manifest.tables.read].sort()).toEqual(
        ['mandala_embeddings', 'scoring_weights', 'trend_signals'].sort()
      );
    });

    it('writes ONLY to keyword_scores (Layer 2 boundary)', () => {
      expect(manifest.tables.write).toEqual(['keyword_scores']);
    });

    it('does NOT write to scoring_weights (sensitive — VOC only per architecture §6 rule 3)', () => {
      expect(manifest.tables.write).not.toContain('scoring_weights');
    });

    it('does NOT write to trend_signals (Layer 1 ownership belongs to trend-collector)', () => {
      expect(manifest.tables.write).not.toContain('trend_signals');
    });
  });

  describe('dependencies (Phase 2b)', () => {
    it('declares Mac Mini Ollama as an OPTIONAL dependency (degraded mode allowed)', () => {
      const deps = manifest.dependencies ?? [];
      expect(deps).toHaveLength(1);
      const dep = deps[0];
      expect(dep?.env).toBe('OLLAMA_URL');
      expect(dep?.required).toBe(false); // soft — falls back to placeholder
    });

    it('does NOT require any hard external API key (no YouTube, no Naver)', () => {
      const deps = manifest.dependencies ?? [];
      const required = deps.filter((d) => d.required);
      expect(required).toHaveLength(0);
    });
  });

  describe('Phase 1.5a + 2a constants', () => {
    it('default sources include LLM-extracted + Suggest (Phase 1.5a redesign)', () => {
      expect(IKS_SCORER_DEFAULT_SOURCES).toContain('youtube_trending_extracted');
      expect(IKS_SCORER_DEFAULT_SOURCES).toContain('youtube_suggest');
    });

    it('does NOT include the deprecated youtube_trending source (title-as-keyword bug)', () => {
      expect(IKS_SCORER_DEFAULT_SOURCES).not.toContain('youtube_trending');
    });

    it('does not include Naver sources yet (Phase 1.5)', () => {
      expect(IKS_SCORER_DEFAULT_SOURCES).not.toContain('naver_datalab');
      expect(IKS_SCORER_DEFAULT_SOURCES).not.toContain('naver_shopping');
    });

    it('uses 7-day TTL aligned with weekly recommendation cycle', () => {
      expect(IKS_SCORER_TTL_DAYS).toBe(7);
    });
  });
});
