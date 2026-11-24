-- Per-mandala learner context. Nullable jsonb, no default: existing rows stay NULL and no code
-- reads or writes it yet (column first; shape decided later). Additive and idempotent.
ALTER TABLE public.user_mandalas ADD COLUMN IF NOT EXISTS context jsonb;

-- Write paths (grep "user_mandalas" src scripts supabase): every INSERT is a Prisma create/createMany
-- with named fields (src/modules/mandala/manager.ts, src/modules/sharing/manager.ts,
-- scripts/data/seed-explore-templates.ts); every raw UPDATE sets named columns
-- (src/api/routes/admin/content.ts, src/api/routes/admin/search-algorithms.ts); no positional
-- INSERT exists. The ontology.sync_mandala trigger reads named NEW columns only. None of them writes
-- context, so it stays NULL.
-- Rollback: ALTER TABLE public.user_mandalas DROP COLUMN IF EXISTS context;
NOTIFY pgrst, 'reload schema';
