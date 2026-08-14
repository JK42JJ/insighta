-- app_notices: banner kind + countdown target + CTA for animated 새소식 cards (2026-07-16).
-- prisma db push silent-fails on Supabase — apply to local AND prod; verify with \d app_notices.
-- Idempotent (ADD COLUMN IF NOT EXISTS).
ALTER TABLE app_notices ADD COLUMN IF NOT EXISTS kind      varchar(24) NOT NULL DEFAULT 'plain';
ALTER TABLE app_notices ADD COLUMN IF NOT EXISTS event_at  timestamptz;
ALTER TABLE app_notices ADD COLUMN IF NOT EXISTS cta_label varchar(40);
ALTER TABLE app_notices ADD COLUMN IF NOT EXISTS cta_url   varchar(400);
NOTIFY pgrst, 'reload schema';
