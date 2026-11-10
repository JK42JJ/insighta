-- Morning feed: card info items (one-liner, reason, audio language, link count, chapters) and
-- per-user watch progress. Additive and idempotent; no existing row is touched.
-- YouTube API derived data may be kept at most 30 days without refresh: readers ignore rows past expires_at.
CREATE TABLE IF NOT EXISTS public.morning_feed_card_info (
  video_id       varchar(20) PRIMARY KEY,
  one_liner      text,
  reason         text,
  audio_language varchar(12),
  link_count     integer,
  chapters       jsonb,
  refreshed_at   timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL DEFAULT now() + interval '30 days'
);
CREATE INDEX IF NOT EXISTS idx_mf_card_info_expires ON public.morning_feed_card_info (expires_at);

CREATE TABLE IF NOT EXISTS public.morning_feed_watch (
  user_id         uuid        NOT NULL,
  video_id        varchar(20) NOT NULL,
  watched_seconds integer     NOT NULL DEFAULT 0 CHECK (watched_seconds >= 0),
  last_position   integer     NOT NULL DEFAULT 0 CHECK (last_position >= 0),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, video_id)
);

-- Write paths (grep "morning_feed_card_info|morning_feed_watch" src): src/modules/morning-feed/*.
-- Rollback: DROP TABLE public.morning_feed_watch; DROP TABLE public.morning_feed_card_info;
NOTIFY pgrst, 'reload schema';
