-- Beta application: learning-goal sentence from the design's apply form. Idempotent.
ALTER TABLE public.beta_applications ADD COLUMN IF NOT EXISTS goal varchar(500);
