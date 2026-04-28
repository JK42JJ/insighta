import { DEFAULT_SEMANTIC_ALPHA, DEFAULT_SEMANTIC_BETA } from '@/modules/video-dictionary';

import {
  DEFAULT_CENTER_GATE_MODE,
  DEFAULT_MAX_QUERIES,
  DEFAULT_MIN_VIEW_COUNT,
  DEFAULT_MIN_VIEWS_PER_DAY,
  DEFAULT_PUBLISHED_AFTER_DAYS,
  DEFAULT_YOUTUBE_SEARCH_TIMEOUT_MS,
  loadV3Config,
} from '../config';
import { DEFAULT_RECENCY_HALF_LIFE_MONTHS, DEFAULT_RECENCY_WEIGHT } from '../mandala-filter';

describe('loadV3Config', () => {
  test('empty env → activated defaults (Tier 1 off, recency on, 3yr cutoff, semantic off, yt timeout 1s, center-gate substring, quality gate off)', () => {
    expect(loadV3Config({})).toEqual({
      enableTier1Cache: false,
      recencyWeight: DEFAULT_RECENCY_WEIGHT,
      recencyHalfLifeMonths: DEFAULT_RECENCY_HALF_LIFE_MONTHS,
      publishedAfterDays: DEFAULT_PUBLISHED_AFTER_DAYS,
      enableSemanticRerank: false,
      semanticAlpha: DEFAULT_SEMANTIC_ALPHA,
      semanticBeta: DEFAULT_SEMANTIC_BETA,
      enableWhitelistGate: false,
      youtubeSearchTimeoutMs: DEFAULT_YOUTUBE_SEARCH_TIMEOUT_MS,
      centerGateMode: DEFAULT_CENTER_GATE_MODE,
      maxQueries: DEFAULT_MAX_QUERIES,
      enableQualityGate: false,
      minViewCount: DEFAULT_MIN_VIEW_COUNT,
      minViewsPerDay: DEFAULT_MIN_VIEWS_PER_DAY,
      semanticMaxCandidates: 30, // PR-Y0b2 default
      useYoutubeRankingOnly: false, // PR-Y0d default
    });
  });

  test('V3_ENABLE_TIER1_CACHE="true" → enabled (case-insensitive, trimmed)', () => {
    expect(loadV3Config({ V3_ENABLE_TIER1_CACHE: 'true' }).enableTier1Cache).toBe(true);
    expect(loadV3Config({ V3_ENABLE_TIER1_CACHE: '  TRUE  ' }).enableTier1Cache).toBe(true);
    expect(loadV3Config({ V3_ENABLE_TIER1_CACHE: 'false' }).enableTier1Cache).toBe(false);
    expect(loadV3Config({ V3_ENABLE_TIER1_CACHE: '' }).enableTier1Cache).toBe(false);
  });

  test('V3_RECENCY_WEIGHT parses valid [0,1] values', () => {
    expect(loadV3Config({ V3_RECENCY_WEIGHT: '0.15' }).recencyWeight).toBeCloseTo(0.15, 6);
    expect(loadV3Config({ V3_RECENCY_WEIGHT: '0' }).recencyWeight).toBe(0);
    expect(loadV3Config({ V3_RECENCY_WEIGHT: '1' }).recencyWeight).toBe(1);
  });

  test('invalid V3_RECENCY_WEIGHT → baseline (entire config falls back)', () => {
    // Out of range: zod rejects, loadV3Config returns baseline
    expect(loadV3Config({ V3_RECENCY_WEIGHT: '1.5' }).recencyWeight).toBe(DEFAULT_RECENCY_WEIGHT);
    expect(loadV3Config({ V3_RECENCY_WEIGHT: '-0.1' }).recencyWeight).toBe(DEFAULT_RECENCY_WEIGHT);
    expect(loadV3Config({ V3_RECENCY_WEIGHT: 'NaN' }).recencyWeight).toBe(DEFAULT_RECENCY_WEIGHT);
  });

  test('V3_RECENCY_HALF_LIFE_MONTHS requires positive integer', () => {
    expect(loadV3Config({ V3_RECENCY_HALF_LIFE_MONTHS: '24' }).recencyHalfLifeMonths).toBe(24);
    // negative / zero / non-int → baseline
    expect(loadV3Config({ V3_RECENCY_HALF_LIFE_MONTHS: '0' }).recencyHalfLifeMonths).toBe(
      DEFAULT_RECENCY_HALF_LIFE_MONTHS
    );
    expect(loadV3Config({ V3_RECENCY_HALF_LIFE_MONTHS: '-3' }).recencyHalfLifeMonths).toBe(
      DEFAULT_RECENCY_HALF_LIFE_MONTHS
    );
  });

  test('V3_PUBLISHED_AFTER_DAYS accepts non-negative integer', () => {
    expect(loadV3Config({ V3_PUBLISHED_AFTER_DAYS: '1095' }).publishedAfterDays).toBe(1095);
    expect(loadV3Config({ V3_PUBLISHED_AFTER_DAYS: '0' }).publishedAfterDays).toBe(0);
    // invalid → entire schema fails → error fallback returns the activated default
    expect(loadV3Config({ V3_PUBLISHED_AFTER_DAYS: '-5' }).publishedAfterDays).toBe(
      DEFAULT_PUBLISHED_AFTER_DAYS
    );
    expect(loadV3Config({ V3_PUBLISHED_AFTER_DAYS: 'garbage' }).publishedAfterDays).toBe(
      DEFAULT_PUBLISHED_AFTER_DAYS
    );
  });

  test('combined: realistic CP391 rollout config', () => {
    expect(
      loadV3Config({
        V3_RECENCY_WEIGHT: '0.15',
        V3_RECENCY_HALF_LIFE_MONTHS: '18',
        V3_PUBLISHED_AFTER_DAYS: '1095',
      })
    ).toEqual({
      enableTier1Cache: false,
      recencyWeight: 0.15,
      recencyHalfLifeMonths: 18,
      publishedAfterDays: 1095,
      enableSemanticRerank: false,
      semanticAlpha: DEFAULT_SEMANTIC_ALPHA,
      semanticBeta: DEFAULT_SEMANTIC_BETA,
      enableWhitelistGate: false,
      youtubeSearchTimeoutMs: DEFAULT_YOUTUBE_SEARCH_TIMEOUT_MS,
      centerGateMode: DEFAULT_CENTER_GATE_MODE,
      maxQueries: DEFAULT_MAX_QUERIES,
      enableQualityGate: false,
      minViewCount: DEFAULT_MIN_VIEW_COUNT,
      minViewsPerDay: DEFAULT_MIN_VIEWS_PER_DAY,
      semanticMaxCandidates: 30, // PR-Y0b2 default
      useYoutubeRankingOnly: false, // PR-Y0d default
    });
  });

  test('quality gate envs — enabled + custom thresholds', () => {
    const cfg = loadV3Config({
      V3_ENABLE_QUALITY_GATE: 'true',
      V3_MIN_VIEW_COUNT: '500',
      V3_MIN_VIEWS_PER_DAY: '5',
    });
    expect(cfg.enableQualityGate).toBe(true);
    expect(cfg.minViewCount).toBe(500);
    expect(cfg.minViewsPerDay).toBe(5);
  });

  test('quality gate envs — unset → flag off, defaults applied', () => {
    const cfg = loadV3Config({});
    expect(cfg.enableQualityGate).toBe(false);
    expect(cfg.minViewCount).toBe(DEFAULT_MIN_VIEW_COUNT);
    expect(cfg.minViewsPerDay).toBe(DEFAULT_MIN_VIEWS_PER_DAY);
  });

  test('V3_YOUTUBE_SEARCH_TIMEOUT_MS parses positive integer', () => {
    expect(loadV3Config({ V3_YOUTUBE_SEARCH_TIMEOUT_MS: '500' }).youtubeSearchTimeoutMs).toBe(500);
    expect(loadV3Config({ V3_YOUTUBE_SEARCH_TIMEOUT_MS: '2000' }).youtubeSearchTimeoutMs).toBe(
      2000
    );
  });

  test('invalid V3_YOUTUBE_SEARCH_TIMEOUT_MS → baseline (entire config falls back)', () => {
    // zero / negative / non-int / garbage → entire schema fails → fallback
    expect(loadV3Config({ V3_YOUTUBE_SEARCH_TIMEOUT_MS: '0' }).youtubeSearchTimeoutMs).toBe(
      DEFAULT_YOUTUBE_SEARCH_TIMEOUT_MS
    );
    expect(loadV3Config({ V3_YOUTUBE_SEARCH_TIMEOUT_MS: '-500' }).youtubeSearchTimeoutMs).toBe(
      DEFAULT_YOUTUBE_SEARCH_TIMEOUT_MS
    );
    expect(loadV3Config({ V3_YOUTUBE_SEARCH_TIMEOUT_MS: 'garbage' }).youtubeSearchTimeoutMs).toBe(
      DEFAULT_YOUTUBE_SEARCH_TIMEOUT_MS
    );
  });

  test('V3_ENABLE_SEMANTIC_RERANK parses boolean flag', () => {
    expect(loadV3Config({ V3_ENABLE_SEMANTIC_RERANK: 'true' }).enableSemanticRerank).toBe(true);
    expect(loadV3Config({ V3_ENABLE_SEMANTIC_RERANK: '  TRUE  ' }).enableSemanticRerank).toBe(true);
    expect(loadV3Config({ V3_ENABLE_SEMANTIC_RERANK: 'false' }).enableSemanticRerank).toBe(false);
    expect(loadV3Config({ V3_ENABLE_SEMANTIC_RERANK: '' }).enableSemanticRerank).toBe(false);
  });

  test('V3_SEMANTIC_ALPHA / _BETA parse valid [0,1] values', () => {
    expect(loadV3Config({ V3_SEMANTIC_ALPHA: '0.75' }).semanticAlpha).toBeCloseTo(0.75, 6);
    expect(loadV3Config({ V3_SEMANTIC_BETA: '0.25' }).semanticBeta).toBeCloseTo(0.25, 6);
    expect(loadV3Config({ V3_SEMANTIC_ALPHA: '0' }).semanticAlpha).toBe(0);
    expect(loadV3Config({ V3_SEMANTIC_BETA: '1' }).semanticBeta).toBe(1);
  });

  test('invalid V3_SEMANTIC_ALPHA → baseline (entire config falls back)', () => {
    expect(loadV3Config({ V3_SEMANTIC_ALPHA: '1.5' }).semanticAlpha).toBe(DEFAULT_SEMANTIC_ALPHA);
    expect(loadV3Config({ V3_SEMANTIC_ALPHA: '-0.1' }).semanticAlpha).toBe(DEFAULT_SEMANTIC_ALPHA);
    expect(loadV3Config({ V3_SEMANTIC_BETA: 'NaN' }).semanticBeta).toBe(DEFAULT_SEMANTIC_BETA);
  });

  test('V3_CENTER_GATE_MODE accepts the four enum values, case-insensitive + trimmed', () => {
    expect(loadV3Config({ V3_CENTER_GATE_MODE: 'substring' }).centerGateMode).toBe('substring');
    expect(loadV3Config({ V3_CENTER_GATE_MODE: 'subword' }).centerGateMode).toBe('subword');
    expect(loadV3Config({ V3_CENTER_GATE_MODE: 'off' }).centerGateMode).toBe('off');
    expect(loadV3Config({ V3_CENTER_GATE_MODE: 'semantic' }).centerGateMode).toBe('semantic');
    expect(loadV3Config({ V3_CENTER_GATE_MODE: '  SUBWORD  ' }).centerGateMode).toBe('subword');
    expect(loadV3Config({ V3_CENTER_GATE_MODE: ' Semantic ' }).centerGateMode).toBe('semantic');
  });

  test('invalid V3_CENTER_GATE_MODE → baseline default (substring)', () => {
    expect(loadV3Config({ V3_CENTER_GATE_MODE: 'garbage' }).centerGateMode).toBe(
      DEFAULT_CENTER_GATE_MODE
    );
    expect(loadV3Config({ V3_CENTER_GATE_MODE: '' }).centerGateMode).toBe(DEFAULT_CENTER_GATE_MODE);
  });

  test('V3_MAX_QUERIES parses positive integer (broad-queries mode)', () => {
    expect(loadV3Config({ V3_MAX_QUERIES: '5' }).maxQueries).toBe(5);
    expect(loadV3Config({ V3_MAX_QUERIES: '1' }).maxQueries).toBe(1);
    expect(loadV3Config({ V3_MAX_QUERIES: '20' }).maxQueries).toBe(20);
  });

  test('invalid V3_MAX_QUERIES → baseline (entire config falls back)', () => {
    expect(loadV3Config({ V3_MAX_QUERIES: '0' }).maxQueries).toBe(DEFAULT_MAX_QUERIES);
    expect(loadV3Config({ V3_MAX_QUERIES: '-3' }).maxQueries).toBe(DEFAULT_MAX_QUERIES);
    expect(loadV3Config({ V3_MAX_QUERIES: 'garbage' }).maxQueries).toBe(DEFAULT_MAX_QUERIES);
    expect(loadV3Config({ V3_MAX_QUERIES: '' }).maxQueries).toBe(DEFAULT_MAX_QUERIES);
  });
});
