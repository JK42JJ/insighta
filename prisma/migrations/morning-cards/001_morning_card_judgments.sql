-- Mobile morning cards (PRD #1788): one row per swipe judgment.
-- No transcript column by design. Idempotent.
CREATE TABLE IF NOT EXISTS public.morning_card_judgments (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid        NOT NULL,
  video_id       varchar(20) NOT NULL,
  domain         varchar(50) NOT NULL,
  verdict        varchar(10) NOT NULL CHECK (verdict IN ('useful', 'skip')),
  reason_tags    text[]      NOT NULL DEFAULT '{}',
  shown_position integer     NOT NULL CHECK (shown_position >= 0),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mc_judgments_user_created
  ON public.morning_card_judgments (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mc_judgments_domain_video
  ON public.morning_card_judgments (domain, video_id);

-- Write paths (grep "from('morning_card_judgments')" supabase/functions src/modules): none
-- in supabase/functions; the only writer is src/modules/morning-cards/judgment-repo.ts
-- (create on swipe, update of reason_tags only on PATCH).
-- Rollback: DROP TABLE public.morning_card_judgments;
