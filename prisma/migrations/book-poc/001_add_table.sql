-- CP438+1 (2026-05-06): mandala_books PoC table.
-- Single-table storage for the generated book index (chapters + sections
-- + atoms + qa pairs as one jsonb blob). PoC keeps schema minimal so the
-- generator + reader can iterate quickly. Section-level confirm flow +
-- cross-video atom split (book_chapters/book_sections/book_atoms) is
-- deferred to P5.
--
-- Apply order:
--   1. Local: psql "$DATABASE_URL" -f prisma/migrations/book-poc/001_add_table.sql
--   2. Local: prisma db push --skip-generate (sync with Prisma)
--   3. Local: psql "$DATABASE_URL" -c "NOTIFY pgrst, 'reload schema'"
--   4. Prod: deploy.yml CI runs prisma db push (LEVEL-3 silent-fail risk!)
--   5. Prod: ssh + docker exec psql apply this raw DDL too (defensive)
--   6. Prod: Supabase Dashboard → Settings → API → "Reload schema"

CREATE TABLE IF NOT EXISTS mandala_books (
  mandala_id     UUID PRIMARY KEY REFERENCES user_mandalas(id) ON DELETE CASCADE,
  book_json      JSONB NOT NULL,
  version        INTEGER NOT NULL DEFAULT 1,
  source_videos  INTEGER NOT NULL DEFAULT 0,
  source_atoms   INTEGER NOT NULL DEFAULT 0,
  generated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mandala_books_updated_at
  ON mandala_books(updated_at DESC);

NOTIFY pgrst, 'reload schema';
