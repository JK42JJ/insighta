-- CP499+ score pipeline — mandala volatility ('volatile' | 'evergreen').
-- Written by merged-gen wizard path when RELEVANCE_RUBRIC_ENABLED; NULL = recency bonus off.
-- prisma db push silent-fail companion DDL (CLAUDE.md hard rule): apply manually
-- local first, then prod (prod execution = separate per-step approval).
ALTER TABLE public.user_mandalas
  ADD COLUMN IF NOT EXISTS volatility varchar(10);
