-- Trend-based Video Recommendation Engine — Layer 4 aggregation view
-- Design: docs/design/insighta-trend-recommendation-engine.md
--
-- Materialized view for keyword accuracy aggregation.
-- Refreshed weekly by recommendation-tuner skill (Phase 6).
-- Apply manually after `prisma db push`:
--   psql "$DATABASE_URL" -f prisma/migrations/keyword_accuracy_view.sql

CREATE MATERIALIZED VIEW IF NOT EXISTS keyword_accuracy AS
SELECT
  rc.keyword,
  rc.domain,
  rc.weight_version,
  COUNT(*) AS total_recs,
  AVG(COALESCE(rf.action_score, 0)) AS avg_accuracy,
  COUNT(CASE WHEN rf.action IN ('add', 'memo') THEN 1 END) AS high_value_actions,
  COUNT(CASE WHEN rf.action = 'dismiss' THEN 1 END) AS dismissals,
  MAX(rc.created_at) AS last_recommendation_at
FROM recommendation_cache rc
LEFT JOIN recommendation_feedback rf ON rf.recommendation_id = rc.id
WHERE rc.created_at > now() - interval '30 days'
GROUP BY rc.keyword, rc.domain, rc.weight_version;

-- Unique index required for CONCURRENT refresh
CREATE UNIQUE INDEX IF NOT EXISTS idx_keyword_accuracy_unique
  ON keyword_accuracy (keyword, COALESCE(domain, ''), weight_version);

CREATE INDEX IF NOT EXISTS idx_keyword_accuracy_avg_desc
  ON keyword_accuracy (avg_accuracy DESC);

-- Note: recommendation_cache.domain is denormalized at insert time
-- (copied from keyword_scores.domain) for query performance.
