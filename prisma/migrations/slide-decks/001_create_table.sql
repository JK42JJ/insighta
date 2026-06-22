-- slide_decks (③ deck UI scaffold) — one deck per mandala (PK = mandala_id).
-- Tracks the deck-generation lifecycle so the FE button can show
-- 없음 → 생성중 → 완료+링크 across reloads (replaces the transient toast).
-- Idempotent (CP421 allowlist requirement).
CREATE TABLE IF NOT EXISTS slide_decks (
  mandala_id   UUID PRIMARY KEY REFERENCES user_mandalas(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'pending',   -- pending | building | done | failed
  pptx_url     TEXT,                               -- serving route path; NULL until done
  error        TEXT,                               -- failure_stage / message when failed
  generated_at TIMESTAMPTZ,                        -- set when status=done
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
