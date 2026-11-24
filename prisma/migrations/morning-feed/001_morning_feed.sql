-- Morning feed (오늘의 픽): per-video annotation (cell, focus, one-line reason, judge score)
-- and three columns on the judgment table (cell, focus, cancel marker). Idempotent.
-- The judgment rows are never deleted: undo sets canceled_at (rule 4: no deleting data).
CREATE TABLE IF NOT EXISTS public.morning_feed_annotations (
  video_id    varchar(20) PRIMARY KEY,
  cell        varchar(50) NOT NULL,
  focus       text[]      NOT NULL DEFAULT '{}',
  why         varchar(80),
  judge_score integer,
  judged_at   timestamptz,
  source      varchar(30) NOT NULL DEFAULT 'manual',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mf_annotations_cell ON public.morning_feed_annotations (cell);

ALTER TABLE public.morning_card_judgments ADD COLUMN IF NOT EXISTS cell        varchar(50);
ALTER TABLE public.morning_card_judgments ADD COLUMN IF NOT EXISTS focus       text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.morning_card_judgments ADD COLUMN IF NOT EXISTS canceled_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_mc_judgments_user_cell
  ON public.morning_card_judgments (user_id, created_at DESC) WHERE cell IS NOT NULL;

-- Write paths (grep "morning_feed_annotations|morning_card_judgments" src): src/modules/morning-feed/*.
-- Rollback: DROP TABLE public.morning_feed_annotations;
--           ALTER TABLE public.morning_card_judgments DROP COLUMN cell, DROP COLUMN focus, DROP COLUMN canceled_at;
