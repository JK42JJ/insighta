import { filterByQualityGate, type QualityGateConfig } from '../quality-gate';

const NOW = new Date('2026-04-22T12:00:00Z').getTime();
const TEN_DAYS_AGO = new Date(NOW - 10 * 86_400_000);
const THREE_HUNDRED_DAYS_AGO = new Date(NOW - 300 * 86_400_000);

const baseOn: QualityGateConfig = {
  enabled: true,
  minViewCount: 1000,
  minViewsPerDay: 10,
};

describe('filterByQualityGate', () => {
  test('gate off → pass-through unchanged', () => {
    const items = [
      { viewCount: 1, publishedDate: TEN_DAYS_AGO },
      { viewCount: 9999, publishedDate: TEN_DAYS_AGO },
    ];
    const result = filterByQualityGate(items, { ...baseOn, enabled: false }, NOW);
    expect(result.kept).toEqual(items);
    expect(result.droppedCount).toBe(0);
  });

  test('gate on — view < 1000 → dropped', () => {
    const items = [{ viewCount: 500, publishedDate: TEN_DAYS_AGO }];
    const result = filterByQualityGate(items, baseOn, NOW);
    expect(result.kept).toHaveLength(0);
    expect(result.droppedCount).toBe(1);
  });

  test('gate on — view=1500, 30d → vpd 50 → passes', () => {
    const thirty = new Date(NOW - 30 * 86_400_000);
    const items = [{ viewCount: 1500, publishedDate: thirty }];
    const result = filterByQualityGate(items, baseOn, NOW);
    expect(result.kept).toHaveLength(1);
    expect(result.droppedCount).toBe(0);
  });

  test('gate on — view=2000, 300d → vpd 6.67 → dropped', () => {
    const items = [{ viewCount: 2000, publishedDate: THREE_HUNDRED_DAYS_AGO }];
    const result = filterByQualityGate(items, baseOn, NOW);
    expect(result.kept).toHaveLength(0);
    expect(result.droppedCount).toBe(1);
  });

  test('gate on — publishedDate null → dropped (zero-signal guard)', () => {
    const items = [{ viewCount: 10000, publishedDate: null }];
    const result = filterByQualityGate(items, baseOn, NOW);
    expect(result.kept).toHaveLength(0);
    expect(result.droppedCount).toBe(1);
  });

  test('gate on — viewCount null → treated as 0 → dropped', () => {
    const items = [{ viewCount: null, publishedDate: TEN_DAYS_AGO }];
    const result = filterByQualityGate(items, baseOn, NOW);
    expect(result.kept).toHaveLength(0);
    expect(result.droppedCount).toBe(1);
  });

  test('gate on — empty input → empty result, zero drops', () => {
    const result = filterByQualityGate([], baseOn, NOW);
    expect(result.kept).toEqual([]);
    expect(result.droppedCount).toBe(0);
  });

  test('gate on — mixed pool preserves order of kept items', () => {
    const items = [
      { id: 'a', viewCount: 50, publishedDate: TEN_DAYS_AGO }, // drop (view)
      { id: 'b', viewCount: 5000, publishedDate: TEN_DAYS_AGO }, // keep
      { id: 'c', viewCount: 1000, publishedDate: THREE_HUNDRED_DAYS_AGO }, // drop (vpd=3.3)
      { id: 'd', viewCount: 20_000, publishedDate: TEN_DAYS_AGO }, // keep
    ];
    const result = filterByQualityGate(items, baseOn, NOW);
    expect(result.kept.map((i) => i.id)).toEqual(['b', 'd']);
    expect(result.droppedCount).toBe(2);
  });

  test('custom thresholds are respected', () => {
    const items = [{ viewCount: 500, publishedDate: TEN_DAYS_AGO }];
    const looser: QualityGateConfig = {
      enabled: true,
      minViewCount: 100,
      minViewsPerDay: 1,
    };
    const result = filterByQualityGate(items, looser, NOW);
    expect(result.kept).toHaveLength(1);
  });
});
