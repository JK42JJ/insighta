/**
 * UI Preferences Types
 *
 * Defines the structure for user-specific UI state persistence,
 * including floating window positions, sizes, and dock preferences.
 */

export type ScratchPadDockPosition = 'top' | 'bottom' | 'left' | 'right';
export type MandalaDockPosition = 'left' | 'right';
export type ViewMode = 'grid' | 'list' | 'list-detail';

/**
 * User UI Preferences stored in Supabase
 */
export interface UIPreferences {
  id?: string;
  user_id?: string;

  // ScratchPad preferences
  scratchpad_is_floating: boolean;
  scratchpad_dock_position: ScratchPadDockPosition;
  scratchpad_position_x: number;
  scratchpad_position_y: number;
  scratchpad_width: number;
  scratchpad_height: number;

  // Mandala preferences
  mandala_is_floating: boolean;
  mandala_is_minimized: boolean;
  mandala_dock_position: MandalaDockPosition;
  mandala_position_x: number;
  mandala_position_y: number;
  mandala_panel_ratio: number;

  // View mode preferences
  view_mode: ViewMode;
  list_panel_ratio: number;

  created_at?: string;
  updated_at?: string;
}

/**
 * Default UI preferences for new users or when not logged in
 */
export const DEFAULT_UI_PREFERENCES: UIPreferences = {
  // ScratchPad defaults
  scratchpad_is_floating: false,
  scratchpad_dock_position: 'top',
  scratchpad_position_x: 100,
  scratchpad_position_y: 100,
  scratchpad_width: 320,
  scratchpad_height: 320,

  // Mandala defaults
  mandala_is_floating: false,
  mandala_is_minimized: false,
  mandala_dock_position: 'left',
  mandala_position_x: 100,
  mandala_position_y: 80,
  mandala_panel_ratio: 30,

  // View mode defaults
  view_mode: 'grid',
  list_panel_ratio: 40,
};

/**
 * Partial update type for useUIPreferences hook
 */
export type UIPreferencesUpdate = Partial<Omit<UIPreferences, 'id' | 'user_id' | 'created_at' | 'updated_at'>>;
