-- P0-3: Demote CoT-corrupted rich summaries (quality_flag → 'low')
-- Issue: #498
-- Root cause: OpenRouter reasoning fallback leaked CoT text into structured JSON
-- Detection: search structured JSONB for CoT marker patterns

-- Step 1: Identify corrupted records (dry run — SELECT only)
-- Run this first to verify which records will be affected.

/*
SELECT
  video_id,
  quality_flag,
  quality_score,
  substring(one_liner, 1, 80) AS one_liner_preview,
  model,
  updated_at
FROM video_rich_summaries
WHERE quality_flag = 'pass'
  AND (
    structured::text ~* '<think>'
    OR structured::text ~* '</think>'
    OR structured::text ~* '\mlet me (start|think|analyze|consider|break)\M'
    OR structured::text ~* '\m(okay|ok),?\s+(so|i|let|now|the)\M'
    OR structured::text ~* '\mwait,?\s+(the|i|let|but|actually)\M'
    OR structured::text ~* '\mfirst,?\s+i(''ll| will| need| should)\M'
    OR structured::text ~* '\mhmm+\M'
    OR structured::text ~* '\mstep \d+:\M'
    OR structured::text ~* '\mthe user (wants|asked|is asking)\M'
    OR one_liner ~* '<think>'
    OR one_liner ~* '\mlet me (start|think|analyze)\M'
    OR one_liner ~* '\m(okay|ok),?\s+(so|i|let)\M'
  );
*/

-- Step 2: Demote corrupted records
UPDATE video_rich_summaries
SET
  quality_flag = 'low',
  quality_score = 0,
  updated_at = now()
WHERE quality_flag = 'pass'
  AND (
    structured::text ~* '<think>'
    OR structured::text ~* '</think>'
    OR structured::text ~* '\mlet me (start|think|analyze|consider|break)\M'
    OR structured::text ~* '\m(okay|ok),?\s+(so|i|let|now|the)\M'
    OR structured::text ~* '\mwait,?\s+(the|i|let|but|actually)\M'
    OR structured::text ~* '\mfirst,?\s+i(''ll| will| need| should)\M'
    OR structured::text ~* '\mhmm+\M'
    OR structured::text ~* '\mstep \d+:\M'
    OR structured::text ~* '\mthe user (wants|asked|is asking)\M'
    OR one_liner ~* '<think>'
    OR one_liner ~* '\mlet me (start|think|analyze)\M'
    OR one_liner ~* '\m(okay|ok),?\s+(so|i|let)\M'
  );
