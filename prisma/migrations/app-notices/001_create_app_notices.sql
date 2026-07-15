-- In-app notices for the dial mobile player (2026-07-15).
-- prisma db push silent-fails on Supabase — apply manually to local AND
-- prod, verify with \d app_notices.
CREATE TABLE IF NOT EXISTS app_notices (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title        varchar(120) NOT NULL,
  body         text NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_app_notices_published ON app_notices(published_at);
ALTER TABLE app_notices ENABLE ROW LEVEL SECURITY;
