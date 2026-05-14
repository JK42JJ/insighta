DROP TRIGGER IF EXISTS system_settings_updated_at ON public.system_settings;
DROP FUNCTION IF EXISTS public.system_settings_set_updated_at();
DROP TABLE IF EXISTS public.system_settings;
NOTIFY pgrst, 'reload schema';
