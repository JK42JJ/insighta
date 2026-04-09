/**
 * Side Note Editor — named constants (no magic numbers).
 *
 * Phase 1-4 MVP. All timing / layout / debounce values live here so that
 * tests can import the same values the UI uses.
 */

/** Delay before a pending change is auto-saved (milliseconds). */
export const AUTO_SAVE_DEBOUNCE_MS = 1500;

/** How long the "저장됨" indicator stays visible before reverting to idle (milliseconds). */
export const SAVED_DISPLAY_MS = 3000;

/** Sheet width (pixels). Matches the design doc spec. */
export const SHEET_WIDTH_PX = 420;

/** Maximum number of retries the auto-save performs on transient errors. */
export const AUTO_SAVE_MAX_RETRIES = 0;

/** React Query cache key prefix for rich notes. */
export const RICH_NOTE_QUERY_KEY = 'side-note-editor.rich-note' as const;

/** Editor placeholder copy. */
export const EDITOR_PLACEHOLDER = '메모를 작성해보세요…';
