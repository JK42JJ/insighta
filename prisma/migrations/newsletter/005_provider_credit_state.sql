-- Provider credit state, shared across pods.
--
-- The first version of this held the state in a module-level Map. Two API pods
-- run, so a 402 seen by one was invisible to the other, and a restart cleared
-- it entirely. The scheduler that fires every twelve hours would therefore
-- meet an empty state every time and hammer a provider it had already been
-- told was empty — 18 calls, three times a day, every one of them a 402.
--
-- Postgres is already on every path that would consult this, and the row is
-- read once per batch rather than per call, so the cost is nil.
--
--   local : docker exec -i supabase-db-dev sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" \
--             psql -U supabase_admin -d postgres' < 005_provider_credit_state.sql
--   prod  : psql "$DIRECT_URL" -f 005_provider_credit_state.sql
--
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS public.llm_provider_credit_state (
  -- 'openrouter', 'anthropic' — the prefix of the logged model id.
  provider      varchar(40) PRIMARY KEY,
  -- When the provider first refused for want of credits in the current spell.
  exhausted_at  timestamptz NOT NULL DEFAULT now(),
  -- Refusals seen since. Useful for telling "it just happened" from "this has
  -- been going on for a day".
  hits          integer NOT NULL DEFAULT 1,
  -- The module that saw the most recent one — the first place a user notices.
  last_module   varchar(50),
  -- Cleared when a call succeeds. A successful call is the only evidence that
  -- credits are back; nothing else is allowed to declare recovery.
  cleared_at    timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- No secondary index. The table holds one row per provider and every query
-- is a lookup by that key, so the primary key answers all of them. An earlier
-- draft added a partial index on (provider) WHERE cleared_at IS NULL; Prisma
-- cannot describe a partial index, and a schema that cannot describe the
-- database is precisely what let `prisma db push` drop columns in #1535.
DROP INDEX IF EXISTS public.idx_llm_credit_state_active;

-- A breaker that only opens is a breaker that never closes. `next_probe_at`
-- is when one call is allowed through to find out whether credits are back.
-- A success clears the row; another 402 pushes this forward again. Claiming
-- the probe is an UPDATE with a WHERE on this column, so of N concurrent
-- callers exactly one gets through and the rest are refused.
ALTER TABLE public.llm_provider_credit_state
  ADD COLUMN IF NOT EXISTS next_probe_at timestamptz NOT NULL DEFAULT now();
