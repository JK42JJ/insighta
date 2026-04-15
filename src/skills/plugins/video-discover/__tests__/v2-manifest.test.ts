import { manifest, V2_TARGET_TOTAL, V2_TARGET_PER_CELL, V2_NUM_CELLS } from '../v2/manifest';

describe('v2 manifest', () => {
  test('id is video-discover-v2 (separate from v1)', () => {
    expect(manifest.id).toBe('video-discover-v2');
  });

  test('does not declare youtube_sync_settings (no OAuth)', () => {
    expect(manifest.tables.read).not.toContain('youtube_sync_settings');
  });

  test('targets are 8 × 5 = 40', () => {
    expect(V2_NUM_CELLS).toBe(8);
    expect(V2_TARGET_PER_CELL).toBe(5);
    expect(V2_TARGET_TOTAL).toBe(40);
  });

  test('writes only recommendation_cache', () => {
    expect(manifest.tables.write).toEqual(['recommendation_cache']);
  });
});
