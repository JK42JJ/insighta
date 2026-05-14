-- Rollback for 001_billing_subscriptions.sql
-- WARNING: drops all subscription state. Export rows first if prod data exists.
--   SELECT * FROM public.billing_subscriptions;

DROP TRIGGER IF EXISTS billing_subscriptions_updated_at ON public.billing_subscriptions;
DROP FUNCTION IF EXISTS public.billing_subscriptions_set_updated_at();
DROP TABLE IF EXISTS public.billing_subscriptions;

NOTIFY pgrst, 'reload schema';
