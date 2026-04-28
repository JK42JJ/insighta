-- CP437 (2026-04-29) — orphan video_rich_summaries cleanup
--
-- Decision (2026-04-28 v2 spec): 26 rows where rich_summary.video_id is
-- not present in youtube_videos.youtube_video_id are stale orphans (likely
-- from videos removed by YouTube or never backfilled into youtube_videos).
-- They cannot be linked to a video resource node and serve no UI purpose.
--
-- Pre-DELETE expected count: 26 (= 1,573 total - 1,547 matched).
-- Post-DELETE expected count: video_rich_summaries total = 1,547.

BEGIN;

DELETE FROM video_rich_summaries
WHERE video_id NOT IN (
  SELECT youtube_video_id FROM youtube_videos
);

COMMIT;

-- Validation:
-- SELECT
--   COUNT(*) AS rs_total,
--   COUNT(DISTINCT rs.video_id) FILTER (
--     WHERE EXISTS (SELECT 1 FROM youtube_videos yv WHERE yv.youtube_video_id = rs.video_id)
--   ) AS rs_matched
-- FROM video_rich_summaries rs;
-- Both numbers must be equal post-migration.
