-- Closed-beta application inbox (2026-07-08). Idempotent.
CREATE TABLE IF NOT EXISTS public.beta_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email varchar(255) NOT NULL UNIQUE,
  status varchar(16) NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  invited_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_beta_applications_status ON public.beta_applications (status);
