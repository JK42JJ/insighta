-- What the provider served from cache, per call.
--
-- The 2026-09-04 audit put prompt caching at the top of the unexploited
-- savings list and then could not size it: the ledger records input_tokens
-- but not how many of them the provider already had. Without that column the
-- question "is caching working" has no answer, and neither does "would it".
--
-- OpenRouter returns it as usage.prompt_tokens_details.cached_tokens and has
-- been returning it all along. Nothing read it.
--
-- NULL means the provider said nothing about caching, which is not the same as
-- zero: a model with no cache support and a model whose cache missed are
-- different facts, and collapsing them would make the first look like a
-- failure of the second.
--
--   local : psql "$DATABASE_URL" -f 002_cached_tokens.sql
--   prod  : psql "$DIRECT_URL"   -f 002_cached_tokens.sql
--
-- Idempotent. Additive: no existing row changes, no existing query breaks.

ALTER TABLE public.llm_call_logs
  ADD COLUMN IF NOT EXISTS cached_input_tokens integer;

COMMENT ON COLUMN public.llm_call_logs.cached_input_tokens IS
  'Prompt tokens served from the provider cache. NULL = provider reported nothing.';
