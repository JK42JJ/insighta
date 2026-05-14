-- billing_events: webhook event ledger for idempotency + audit trail.
-- Every LS webhook lands here first (signature_ok=true/false), then handler
-- transitions billing_subscriptions. Duplicate (provider, provider_event_id)
-- ON CONFLICT DO NOTHING = idempotent retry handling.
--
-- See docs/design/billing-lemonsqueezy-2026-05-13.md §3 L0 + ADR-5.

CREATE TABLE IF NOT EXISTS public.billing_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider          varchar(30) NOT NULL DEFAULT 'lemonsqueezy',
  provider_event_id varchar(255) NOT NULL,
  event_name        varchar(100) NOT NULL,
  payload           jsonb NOT NULL,
  signature_ok      boolean NOT NULL,
  processed_at      timestamptz,
  error_message     text,
  received_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_events_provider_event_unique
    UNIQUE (provider, provider_event_id)
);

CREATE INDEX IF NOT EXISTS idx_billing_events_received
  ON public.billing_events(received_at DESC);

CREATE INDEX IF NOT EXISTS idx_billing_events_unprocessed
  ON public.billing_events(received_at)
  WHERE processed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_billing_events_event_name
  ON public.billing_events(event_name);

NOTIFY pgrst, 'reload schema';
