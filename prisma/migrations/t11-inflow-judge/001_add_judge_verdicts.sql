-- T11 Stage1 (2026-07-14) — inflow judge verdicts, DEDICATED column.
-- Data-write rule: judge output never overwrites existing fields.
ALTER TABLE public.mandala_wizard_precompute
  ADD COLUMN IF NOT EXISTS judge_verdicts jsonb;
