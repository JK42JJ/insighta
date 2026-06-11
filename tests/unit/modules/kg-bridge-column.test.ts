/**
 * KG Bridge — findResourceNode column regression (CP499+).
 *
 * The uvs branch joined youtube_videos on `yv.video_id` — a column that
 * does not exist (the external YouTube id is `youtube_video_id`,
 * schema @unique). Every uvs-branch lookup failed with Postgres 42703
 * and was swallowed upstream → mentions edges for uvs-sourced resources
 * were silently never created. Pin: the raw SQL references the real
 * column and never the phantom one.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

describe('kg-bridge — youtube_videos column name', () => {
  const src = readFileSync(join(process.cwd(), 'src/modules/ontology/kg-bridge.ts'), 'utf8');

  it('uses yv.youtube_video_id (the real external-id column)', () => {
    expect(src).toContain('yv.youtube_video_id');
  });

  it('never references the phantom yv.video_id (42703 source)', () => {
    // `yv.video_id` must not appear except as part of yv.youtube_video_id
    const phantom = src.match(/yv\.video_id\b/g) ?? [];
    expect(phantom).toHaveLength(0);
  });
});
