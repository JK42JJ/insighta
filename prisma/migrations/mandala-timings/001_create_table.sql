-- ============================================================================
-- Mandala create timings: CP420 γ (Path B step 1)
-- ============================================================================
-- Wizard mandala-create 의 per-step timing 을 DB 에 persist.
-- `src/modules/mandala/manager.ts` 의 createMandala 에서 tx commit 직후
-- (ok path) 또는 catch block (error path) 에서 fire-and-forget 으로 INSERT.
--
-- Purpose (CP420 → CP421):
--   - Lever A++ DROP trg_structural_edges_level 의 pre/post M7 비교 (n≥3)
--   - SELECT 만으로 tx_levels_createMany latency 분포 추출 가능
--   - 현재 console.info log 만으로는 docker log retention (~48h) 안에서
--     n=1 샘플만 확보. γ persistence 로 retention 확장.
--
-- Column design:
--   mandala_id NULLABLE: tx rollback 시 mandala row 미생성 (전체 rollback
--     by Prisma $transaction). error outcome 은 mandala 참조 없이 기록.
--   outcome VARCHAR(10): 'ok' | 'error' (manager.ts:476, 486 실제 emit 값)
--   timings JSONB: dup_check, parallel_reads, tx_mandala_create,
--     tx_levels_createMany, tx_find_unique, tx_total, total (일부 key 는
--     error path 에서 set 안 됨 — whatever-set 저장)
--   error TEXT: outcome='error' 시 err.message.slice(0, 500)
--
-- CLAUDE.md LEVEL-3 "prisma db push silent fail 대응":
--   - 본 파일 (feature-namespace fallback DDL) + prisma/schema.prisma
--     (Prisma client type 생성) 양쪽 유지
--   - Deploy verification: Local `\d mandala_create_timings` + Prod
--     `ssh + docker exec psql \d mandala_create_timings`
--   - Idempotent: CREATE IF NOT EXISTS 사용
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.mandala_create_timings (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  mandala_id UUID        REFERENCES public.user_mandalas(id) ON DELETE CASCADE,
  user_id    UUID        NOT NULL,
  outcome    VARCHAR(10) NOT NULL,
  timings    JSONB       NOT NULL,
  error      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mandala_create_timings_mandala_id
  ON public.mandala_create_timings (mandala_id);

CREATE INDEX IF NOT EXISTS idx_mandala_create_timings_created_at_desc
  ON public.mandala_create_timings (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_mandala_create_timings_outcome_created_at
  ON public.mandala_create_timings (outcome, created_at DESC);

-- Sanity check (deploy verification 용)
DO $$
DECLARE
  col_count INT;
BEGIN
  SELECT COUNT(*) INTO col_count
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'mandala_create_timings';

  IF col_count < 7 THEN
    RAISE EXCEPTION 'mandala_create_timings table missing columns: expected ≥7, got %', col_count;
  END IF;
END $$;
