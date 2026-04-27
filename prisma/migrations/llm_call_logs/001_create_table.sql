CREATE TABLE IF NOT EXISTS llm_call_logs (
  call_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module        VARCHAR(50) NOT NULL,
  model         VARCHAR(100) NOT NULL,
  input_tokens  INTEGER,
  output_tokens INTEGER,
  cost_usd      DOUBLE PRECISION,
  latency_ms    INTEGER,
  status        VARCHAR(20) NOT NULL DEFAULT 'success',
  error_message TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id       UUID,
  video_id      VARCHAR(50)
);

CREATE INDEX IF NOT EXISTS idx_llm_call_logs_created_at ON llm_call_logs (created_at);
CREATE INDEX IF NOT EXISTS idx_llm_call_logs_module ON llm_call_logs (module);
CREATE INDEX IF NOT EXISTS idx_llm_call_logs_model ON llm_call_logs (model);
