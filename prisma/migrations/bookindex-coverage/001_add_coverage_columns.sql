-- §1④ PR2 — book-fill coverage progress columns on mandala_books.
-- gate_passed = gate-passed card count (denominator); v2_done = passed cards
-- with usable v2 (in the book now); v2_pending = passed cards whose v2 is still
-- being enqueued/generated. v2_pending > 0 drives the left-sidebar "준비 중"
-- spinner + the note empty-section "준비 중" label.
-- prisma db push silent-fails on Supabase (auth-schema ownership) → apply this
-- raw DDL on local + prod (psql "$DIRECT_URL" -f ...), then verify \d mandala_books.
ALTER TABLE mandala_books ADD COLUMN IF NOT EXISTS gate_passed integer NOT NULL DEFAULT 0;
ALTER TABLE mandala_books ADD COLUMN IF NOT EXISTS v2_done     integer NOT NULL DEFAULT 0;
ALTER TABLE mandala_books ADD COLUMN IF NOT EXISTS v2_pending  integer NOT NULL DEFAULT 0;
