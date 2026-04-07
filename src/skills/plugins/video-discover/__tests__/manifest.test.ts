/**
 * video-discover — manifest contract tests
 *
 * Pins the Phase 3 manifest contract:
 *   - kebab-case id matching directory
 *   - Layer A (in-process, no Temporal yet)
 *   - tables.read includes user_mandalas + mandala_embeddings + keyword_scores + youtube_sync_settings
 *   - tables.write = ['recommendation_cache'] only
 *   - Phase 3 constants (cells, recs/cell, keywords/cell, search results, TTL)
 */

import {
  manifest,
  VIDEO_DISCOVER_CELLS_PER_MANDALA,
  VIDEO_DISCOVER_RECS_PER_CELL,
  VIDEO_DISCOVER_KEYWORDS_PER_CELL,
  VIDEO_DISCOVER_SEARCH_RESULTS_PER_CELL,
  VIDEO_DISCOVER_TTL_DAYS,
  VIDEO_DISCOVER_KEYWORD_POOL_SIZE,
} from '../manifest';
import { validateManifest } from '@/skills/_shared/runtime';

describe('video-discover manifest', () => {
  it('passes validateManifest()', () => {
    expect(() => validateManifest(manifest)).not.toThrow();
  });

  it('is Object.freeze()d', () => {
    expect(Object.isFrozen(manifest)).toBe(true);
  });

  it('uses kebab-case id matching the directory', () => {
    expect(manifest.id).toBe('video-discover');
  });

  it('declares Layer A (in-process, no Temporal yet)', () => {
    expect(manifest.layer).toBe('A');
  });

  it('declares idempotent=true (upsert by user/mandala/video)', () => {
    expect(manifest.idempotent).toBe(true);
  });

  describe('trigger', () => {
    it('is manual (event wiring deferred to Phase 3.5)', () => {
      expect(manifest.trigger).toEqual({ type: 'manual' });
    });
  });

  describe('input schema', () => {
    it('requires mandala_id', () => {
      expect(manifest.inputSchema).toMatchObject({
        type: 'object',
        required: ['mandala_id'],
      });
    });
  });

  describe('table ownership', () => {
    it('reads the four sources needed to match user mandala to keywords', () => {
      expect([...manifest.tables.read].sort()).toEqual(
        ['keyword_scores', 'mandala_embeddings', 'user_mandalas', 'youtube_sync_settings'].sort()
      );
    });

    it('writes ONLY to recommendation_cache (Layer 3 boundary)', () => {
      expect(manifest.tables.write).toEqual(['recommendation_cache']);
    });

    it('does NOT write to keyword_scores or trend_signals (Layer 1/2 ownership respected)', () => {
      expect(manifest.tables.write).not.toContain('keyword_scores');
      expect(manifest.tables.write).not.toContain('trend_signals');
    });
  });

  describe('dependencies', () => {
    it('declares NO env-level dependencies (OAuth lives in youtube_sync_settings, not env)', () => {
      const deps = manifest.dependencies ?? [];
      expect(deps).toHaveLength(0);
    });
  });

  describe('Phase 3 constants', () => {
    it('matches mandala 8x8 structure (8 cells, 3 recs per cell = 24 total)', () => {
      expect(VIDEO_DISCOVER_CELLS_PER_MANDALA).toBe(8);
      expect(VIDEO_DISCOVER_RECS_PER_CELL).toBe(3);
    });

    it('uses 1 keyword per cell (lean — quota-conscious)', () => {
      expect(VIDEO_DISCOVER_KEYWORDS_PER_CELL).toBe(1);
    });

    it('fetches 10 search results per cell to leave room for diversity dedup', () => {
      expect(VIDEO_DISCOVER_SEARCH_RESULTS_PER_CELL).toBe(10);
    });

    it('uses 7-day TTL (aligns with weekly recommendation cycle)', () => {
      expect(VIDEO_DISCOVER_TTL_DAYS).toBe(7);
    });

    it('loads top 200 keyword_scores by IKS into the pool', () => {
      expect(VIDEO_DISCOVER_KEYWORD_POOL_SIZE).toBe(200);
    });
  });
});
