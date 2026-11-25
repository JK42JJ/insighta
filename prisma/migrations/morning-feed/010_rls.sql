-- Row level security on the morning tables (2026-11-25). Found on staging: RLS off and the anon role
-- holding every privilege, so the public key in the web bundle could read and change these rows
-- through PostgREST. The app never uses them that way (no supabase-js `.from('morning_...')`): the API
-- connects as the table owner, which row level security does not apply to. No policy = no
-- anon/authenticated access. Idempotent; no row is touched.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'morning_pages', 'morning_brief_feedback', 'morning_usage_events', 'morning_card_judgments',
    'morning_feed_annotations', 'morning_feed_card_info', 'morning_feed_watch',
    'morning_virtual_day', 'morning_watch_batches'
  ] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    END IF;
  END LOOP;
END $$;
REVOKE ALL ON public.morning_app_feedback FROM anon, authenticated;
-- Rollback: ALTER TABLE ... DISABLE ROW LEVEL SECURITY; GRANT ALL ON ... TO anon, authenticated;
NOTIFY pgrst, 'reload schema';
