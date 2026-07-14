-- Share v2 short-link backbone (2026-07-14).
-- prisma db push silent-fails on Supabase (auth schema ownership) — apply
-- this file manually to local AND prod, then verify with \d share_links.
CREATE TABLE IF NOT EXISTS share_links (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        varchar(16) UNIQUE NOT NULL,
  target_type varchar(24) NOT NULL,
  target_id   uuid NOT NULL,
  video_id    varchar(16),
  mode        varchar(24) NOT NULL DEFAULT 'guest_listen',
  expires_at  timestamptz,
  created_by  uuid NOT NULL,
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_share_links_target ON share_links(target_id);
CREATE INDEX IF NOT EXISTS idx_share_links_creator ON share_links(created_by);

-- RLS: API accesses via service role; no anon/authenticated direct access.
ALTER TABLE share_links ENABLE ROW LEVEL SECURITY;
