-- PR3a — note_documents.based_on_book_version: the mandala_books.version this
-- note was generated from. Drives stale detection (book.version > this ⇒ the
-- book was re-filled with new cards/translations ⇒ note is stale).
-- prisma db push silent-fails on Supabase (auth-schema ownership) → apply this
-- raw DDL on local + prod (psql "$DIRECT_URL" -f ...), verify \d note_documents,
-- BEFORE deploying the code that SELECTs the column (PR2 GET-500 lesson).
ALTER TABLE note_documents ADD COLUMN IF NOT EXISTS based_on_book_version integer NOT NULL DEFAULT 0;
