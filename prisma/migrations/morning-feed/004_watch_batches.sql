-- Morning feed watch screen: the server-issued daily batch per goal cell, and which screen wrote a
-- judgment. Additive and idempotent; no existing row is touched (surface stays NULL on old rows =
-- swipe deck / other).
CREATE TABLE IF NOT EXISTS public.morning_watch_batches (
  user_id    uuid        NOT NULL,
  day        date        NOT NULL,
  cell       varchar(50) NOT NULL,
  video_ids  text[]      NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, day, cell)
);

ALTER TABLE public.morning_card_judgments ADD COLUMN IF NOT EXISTS surface varchar(16);

-- Write paths (grep "morning_watch_batches|morning_card_judgments" src):
--   morning_watch_batches: src/modules/morning-feed/feed.ts getOrCreateWatchBatch (INSERT ... ON CONFLICT DO NOTHING).
--   morning_card_judgments.surface: src/modules/morning-feed/feed.ts saveFeedJudgment (NULL or 'watch');
--   cancelLastFeedJudgment and src/modules/morning-cards/judgment-repo.ts leave it untouched.
-- Rollback: DROP TABLE public.morning_watch_batches;
--           ALTER TABLE public.morning_card_judgments DROP COLUMN surface;
NOTIFY pgrst, 'reload schema';
