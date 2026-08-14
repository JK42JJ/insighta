-- Invite tickets v2 (2026-07-15). Apply to local AND prod (prisma db push
-- silent-fail rule), verify with \d invite_links.
CREATE TABLE IF NOT EXISTS invite_links (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        varchar(16) UNIQUE NOT NULL,
  inviter_id  uuid NOT NULL,
  invitee_id  uuid,
  redeemed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_invite_links_inviter ON invite_links(inviter_id);
CREATE INDEX IF NOT EXISTS idx_invite_links_invitee ON invite_links(invitee_id);
ALTER TABLE invite_links ENABLE ROW LEVEL SECURITY;
