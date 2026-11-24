-- Morning feed: a third verdict, 'pass' (the card was replaced without a like or dislike).
-- 'skip' now means dislike (X). Existing rows are untouched. Idempotent.
ALTER TABLE public.morning_card_judgments DROP CONSTRAINT IF EXISTS morning_card_judgments_verdict_check;
ALTER TABLE public.morning_card_judgments
  ADD CONSTRAINT morning_card_judgments_verdict_check CHECK (verdict IN ('useful', 'skip', 'pass'));
-- Rollback: delete or recode any 'pass' rows first, then restore CHECK (verdict IN ('useful','skip')).
