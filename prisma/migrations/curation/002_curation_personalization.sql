-- Curation personalization tables (Growth Hub, 2026-07-20).
-- Design: docs/design/growth-hub-curation-personalized-2026-07-20.md (§7).
-- prisma db push silent-fails on Supabase — apply manually to local AND prod,
-- verify with \d public.curation_interest_profile / \d public.curation_proposals.
--
-- curation_interest_profile: async-built YouTube interest profile (one per user).
--   Built off subscriptions + playlists + saved videos → extractKeywordsBatch.
--   GET /curations/suggest reads this (never builds inline — B4 latency).
-- curation_proposals: append-only proposal log = the reinforcement input.
--   NO topic_affinity column anywhere — reinforce() is derived at read time by
--   scanning this log (data-reversibility hard rule: original events only,
--   nothing mutable to roll back). UNIQUE(user_id, week_of) dedups repeated
--   suggest opens (one proposal row per user per week).
-- Schema is qualified public.* (search_path-independent).

CREATE TABLE IF NOT EXISTS public.curation_interest_profile (
  user_id    uuid PRIMARY KEY,
  -- [{ kw: string, domain: string, weight: number }] — normalized interest vector
  profile    jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- building | ready | stale | error
  status     varchar(12) NOT NULL DEFAULT 'building',
  built_at   timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.curation_interest_profile ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.curation_proposals (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL,
  -- Monday of the proposal week (dedup + reinforcement horizon)
  week_of        date NOT NULL,
  -- the 3 proposed topics: [{ topic, domain, score, rising, hook }]
  proposed       jsonb NOT NULL,
  -- which topic the user chose (null = not yet selected / abandoned)
  selected_topic text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, week_of)
);
CREATE INDEX IF NOT EXISTS idx_curation_proposals_user_id ON public.curation_proposals(user_id);
ALTER TABLE public.curation_proposals ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
