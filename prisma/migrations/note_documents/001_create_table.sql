-- CP445 (2026-05-08) — Obsidian-style note mode persistence.
--
-- One row per (user_id, mandala_id). Drives the per-mandala TipTap
-- editor in note mode. `original_json` is the immutable baseline set
-- at first create from `mandala_books.book_json`; `content_json` is
-- the user-edited TipTap JSON.
--
-- Hard Rule (CLAUDE.md "prisma db push silent fail"): this raw DDL
-- runs alongside `prisma db push` to guarantee the table is created
-- on Supabase (which silently no-ops the public-schema add when auth
-- ownership errors occur).

CREATE TABLE IF NOT EXISTS public.note_documents (
  id            UUID        NOT NULL DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL,
  mandala_id    UUID        NOT NULL,
  content_json  JSONB       NOT NULL,
  original_json JSONB       NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT note_documents_pkey PRIMARY KEY (id),
  CONSTRAINT uq_note_documents_user_mandala UNIQUE (user_id, mandala_id),
  CONSTRAINT fk_note_documents_user
    FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE,
  CONSTRAINT fk_note_documents_mandala
    FOREIGN KEY (mandala_id) REFERENCES public.user_mandalas (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_note_documents_user_updated_at
  ON public.note_documents (user_id, updated_at DESC);

-- ALTER 직후 Postgrest schema reload (CLAUDE.md absolute rule)
NOTIFY pgrst, 'reload schema';
