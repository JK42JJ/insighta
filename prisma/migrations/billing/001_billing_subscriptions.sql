-- billing_subscriptions: provider-agnostic subscription state mirror.
-- Provider = Lemon Squeezy (Merchant of Record, ADR-3 single-provider, YAGNI).
-- See docs/design/billing-lemonsqueezy-2026-05-13.md §3 L0.
--
-- status: text + CHECK constraint (codebase convention — schema.prisma has 0 enum types).
-- One ACTIVE-ish subscription per user enforced via partial unique index.

CREATE TABLE IF NOT EXISTS public.billing_subscriptions (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider                 varchar(30) NOT NULL DEFAULT 'lemonsqueezy',
  provider_subscription_id varchar(255) NOT NULL,
  provider_customer_id     varchar(255),
  variant_id               varchar(255) NOT NULL,
  plan_code                varchar(50) NOT NULL,
  status                   varchar(20) NOT NULL DEFAULT 'PENDING',
  current_period_start     timestamptz,
  current_period_end       timestamptz,
  cancel_at_period_end     boolean NOT NULL DEFAULT false,
  cancelled_at             timestamptz,
  amount_cents             integer NOT NULL,
  currency                 char(3) NOT NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_subscriptions_status_chk
    CHECK (status IN ('PENDING','ACTIVE','PAST_DUE','CANCELLED','EXPIRED','PAUSED')),
  CONSTRAINT billing_subscriptions_provider_sub_unique
    UNIQUE (provider, provider_subscription_id)
);

CREATE INDEX IF NOT EXISTS idx_billing_subscriptions_user
  ON public.billing_subscriptions(user_id);

CREATE INDEX IF NOT EXISTS idx_billing_subscriptions_status
  ON public.billing_subscriptions(status)
  WHERE status IN ('ACTIVE', 'PAST_DUE');

-- One active-ish subscription per user (ACTIVE / PAST_DUE / PAUSED).
-- CANCELLED + EXPIRED rows are kept as history; new active subscription allowed.
CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_subscriptions_user_active
  ON public.billing_subscriptions(user_id)
  WHERE status IN ('ACTIVE', 'PAST_DUE', 'PAUSED');

-- updated_at trigger (reuse existing pattern if present, else create fn).
CREATE OR REPLACE FUNCTION public.billing_subscriptions_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS billing_subscriptions_updated_at ON public.billing_subscriptions;
CREATE TRIGGER billing_subscriptions_updated_at
  BEFORE UPDATE ON public.billing_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.billing_subscriptions_set_updated_at();

-- PostgREST schema reload (CLAUDE.md LEVEL-2 — ALTER 직후 reload 필수).
NOTIFY pgrst, 'reload schema';
