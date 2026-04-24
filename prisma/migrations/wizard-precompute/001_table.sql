-- ============================================================================
-- Wizard Precompute Pipeline — SLO-1 dashboard-first-card ≤1s (CP424.2)
-- ============================================================================
-- Per docs/design/precompute-pipeline.md (CP417 draft).
--
-- Flow:
--   Step 1 goal 확정 → FE `sessionId = randomUUID()` → /wizard-stream?previewOnly=true
--     + body.session_id → BE fire-and-forget `startPrecompute(session_id)` →
--     runV3Discover(ephemeralContext) → UPDATE status=done + discover_result
--   Step 3 save → FE /create-with-data body.session_id → BE lookup →
--     INSERT recommendation_cache + cardPublisher.notify → status=consumed
--   Miss → existing post-creation pipeline (backward-compat)
--
-- Feature flag: WIZARD_PRECOMPUTE_ENABLED (compose env, default false).
--   flag off: /wizard-stream precompute skip, /create-with-data lookup skip.
--   기존 동작 100% 보존.
--
-- TTL: 10min. pg_cron */5 min sweep removes expired non-consumed rows.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.mandala_wizard_precompute (
  session_id       UUID         PRIMARY KEY,
  user_id          UUID         NOT NULL,
  goal             TEXT         NOT NULL,
  language         VARCHAR(5)   NOT NULL,
  focus_tags       TEXT[]       NOT NULL DEFAULT '{}',
  target_level     VARCHAR(30),
  status           VARCHAR(20)  NOT NULL DEFAULT 'pending',
    -- 'pending' | 'running' | 'done' | 'failed' | 'consumed'
  discover_result  JSONB,       -- { slots: [...], tier1_matches, tier2_matches, debug, metrics }
  error_message    TEXT,
  consumed_mandala_id UUID,     -- set on consume; null until then
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  consumed_at      TIMESTAMPTZ,
  expires_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW() + INTERVAL '10 minutes'
);

CREATE INDEX IF NOT EXISTS idx_precompute_user_created
  ON public.mandala_wizard_precompute (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_precompute_expires
  ON public.mandala_wizard_precompute (expires_at)
  WHERE status != 'consumed';

CREATE INDEX IF NOT EXISTS idx_precompute_status
  ON public.mandala_wizard_precompute (status);

-- pg_cron TTL sweep — remove expired non-consumed rows every 5 minutes.
-- Consumed rows are kept permanently as audit trail; expires_at filter
-- in the index keeps the sweep cost O(expired rows).
-- Requires pg_cron extension (self-hosted Supabase already has it per
-- design doc §Redis vs 테이블 결정 근거 item 3).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Unschedule any prior version idempotently, then re-schedule.
    PERFORM cron.unschedule(jobid)
    FROM cron.job
    WHERE jobname = 'precompute-ttl-sweep';

    PERFORM cron.schedule(
      'precompute-ttl-sweep',
      '*/5 * * * *',
      $cron$DELETE FROM public.mandala_wizard_precompute
            WHERE expires_at < NOW() AND status != 'consumed'$cron$
    );
  ELSE
    RAISE NOTICE 'pg_cron extension not installed — TTL sweep skipped; rows accumulate until manual cleanup.';
  END IF;
END $$;

-- Sanity check (deploy verification)
DO $$
DECLARE
  col_count INT;
  idx_count INT;
BEGIN
  SELECT COUNT(*) INTO col_count
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'mandala_wizard_precompute';

  SELECT COUNT(*) INTO idx_count
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND tablename = 'mandala_wizard_precompute';

  IF col_count < 12 THEN
    RAISE EXCEPTION 'mandala_wizard_precompute table missing columns: expected >=12, got %', col_count;
  END IF;
  IF idx_count < 3 THEN  -- PK + 3 secondary
    RAISE EXCEPTION 'mandala_wizard_precompute indexes missing: expected >=4 (incl PK), got %', idx_count;
  END IF;
END $$;

-- PostgREST schema reload (ALTER/CREATE → Supabase client silent-drop 방지).
NOTIFY pgrst, 'reload schema';
