-- Rollback for 002_billing_events.sql
-- WARNING: drops webhook audit trail. Export rows first if needed:
--   COPY (SELECT * FROM public.billing_events) TO '/tmp/billing_events_backup.csv' CSV HEADER;

DROP TABLE IF EXISTS public.billing_events;

NOTIFY pgrst, 'reload schema';
