-- Invite tickets (2026-07-15): record which member spent a ticket on this
-- invitation. Nullable — admin/manual invites stay NULL.
-- Apply manually to local AND prod (prisma db push silent-fail rule).
ALTER TABLE beta_applications ADD COLUMN IF NOT EXISTS invited_by uuid;
CREATE INDEX IF NOT EXISTS idx_beta_applications_invited_by ON beta_applications(invited_by);
