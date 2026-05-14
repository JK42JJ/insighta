-- system_settings: generic key-value runtime config for admin-toggleable flags.
-- Initial use case (CP456 Phase 5): `billing_enabled` — admin-gated launch
-- switch for the LS billing flow.
--
-- raw DDL required per CLAUDE.md "prisma db push silent fail" LEVEL-3.

CREATE TABLE IF NOT EXISTS public.system_settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE OR REPLACE FUNCTION public.system_settings_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS system_settings_updated_at ON public.system_settings;
CREATE TRIGGER system_settings_updated_at
  BEFORE UPDATE ON public.system_settings
  FOR EACH ROW EXECUTE FUNCTION public.system_settings_set_updated_at();

-- Default: billing disabled at launch — admin must toggle on after KYC pass.
INSERT INTO public.system_settings (key, value)
VALUES ('billing_enabled', 'false'::jsonb)
ON CONFLICT (key) DO NOTHING;

NOTIFY pgrst, 'reload schema';
