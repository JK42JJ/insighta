-- User UI Preferences for floating window state persistence
-- This table stores per-user UI state including floating window positions/sizes and dock preferences

CREATE TABLE IF NOT EXISTS user_ui_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- ScratchPad (아이디에이션) preferences
  scratchpad_is_floating BOOLEAN NOT NULL DEFAULT false,
  scratchpad_dock_position TEXT DEFAULT 'top' CHECK (scratchpad_dock_position IN ('top', 'bottom', 'left', 'right')),
  scratchpad_position_x INTEGER DEFAULT 100,
  scratchpad_position_y INTEGER DEFAULT 100,
  scratchpad_width INTEGER DEFAULT 320,
  scratchpad_height INTEGER DEFAULT 320,

  -- Mandala (만다라트) preferences
  mandala_is_floating BOOLEAN NOT NULL DEFAULT false,
  mandala_is_minimized BOOLEAN NOT NULL DEFAULT false,
  mandala_dock_position TEXT DEFAULT 'left' CHECK (mandala_dock_position IN ('left', 'right')),
  mandala_position_x INTEGER DEFAULT 100,
  mandala_position_y INTEGER DEFAULT 80,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

-- Enable Row Level Security
ALTER TABLE user_ui_preferences ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Users can only access their own preferences
CREATE POLICY "Users can view own UI preferences"
  ON user_ui_preferences FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own UI preferences"
  ON user_ui_preferences FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own UI preferences"
  ON user_ui_preferences FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own UI preferences"
  ON user_ui_preferences FOR DELETE
  USING (auth.uid() = user_id);

-- Index for efficient user lookup
CREATE INDEX IF NOT EXISTS idx_user_ui_preferences_user_id ON user_ui_preferences(user_id);

-- Auto-update trigger for updated_at (reuse existing function if available)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at_column') THEN
    CREATE OR REPLACE FUNCTION update_updated_at_column()
    RETURNS TRIGGER AS $func$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $func$ LANGUAGE plpgsql;
  END IF;
END
$$;

CREATE TRIGGER update_user_ui_preferences_updated_at
  BEFORE UPDATE ON user_ui_preferences
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
