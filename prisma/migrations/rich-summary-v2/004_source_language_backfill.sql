-- CP437 (2026-04-29) — video_rich_summaries.source_language backfill
--
-- Spec §5: Hangul ratio > 0.30 → 'ko', else → 'en'. Compute per-row from
-- youtube_videos.title + COALESCE(description,'') + COALESCE(channel_title,'').
--
-- Hangul Unicode block: U+AC00..U+D7A3 (matches /[가-힯]/u in JS).
-- Letter set excludes digits/punctuation: Hangul + ASCII Latin only.

BEGIN;

WITH lang AS (
  SELECT
    rs.video_id,
    yv.title || ' ' || COALESCE(yv.description, '') || ' ' || COALESCE(yv.channel_title, '') AS combined
  FROM video_rich_summaries rs
  JOIN youtube_videos yv ON yv.youtube_video_id = rs.video_id
), score AS (
  SELECT
    video_id,
    -- Hangul char count
    COALESCE(LENGTH(REGEXP_REPLACE(combined, '[^가-힯]', '', 'g')), 0) AS hangul_count,
    -- Hangul + Latin letter count (denominator)
    COALESCE(LENGTH(REGEXP_REPLACE(combined, '[^가-힯A-Za-z]', '', 'g')), 0) AS letter_count
  FROM lang
)
UPDATE video_rich_summaries rs
SET source_language = CASE
  WHEN s.letter_count = 0 THEN 'ko'  -- emoji/digits-only → default ko (prod 99%+ Korean)
  WHEN s.hangul_count::float / s.letter_count > 0.30 THEN 'ko'
  ELSE 'en'
END
FROM score s
WHERE rs.video_id = s.video_id
  AND rs.source_language IS NULL;

COMMIT;

-- Validation:
-- SELECT source_language, COUNT(*)::int AS count
-- FROM video_rich_summaries
-- GROUP BY source_language
-- ORDER BY count DESC;
