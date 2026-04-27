ALTER TABLE video_rich_summaries ADD COLUMN IF NOT EXISTS m1_title_overlap DOUBLE PRECISION;
ALTER TABLE video_rich_summaries ADD COLUMN IF NOT EXISTS m3_timestamp_null_ratio DOUBLE PRECISION;
ALTER TABLE video_rich_summaries ADD COLUMN IF NOT EXISTS m3_timestamp_pattern VARCHAR(20);
ALTER TABLE video_rich_summaries ADD COLUMN IF NOT EXISTS specificity_score DOUBLE PRECISION;

CREATE INDEX IF NOT EXISTS idx_vrs_specificity ON video_rich_summaries (specificity_score) WHERE specificity_score IS NOT NULL;
