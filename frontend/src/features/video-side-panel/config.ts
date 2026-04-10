/**
 * Video Side Panel — named constants.
 * Design tokens extracted from insighta-side-editor-mockup-v3.html.
 */

/** Panel width in pixels (mockup spec). */
export const PANEL_WIDTH_PX = 560;

/** Slide animation timing (mockup spec). */
export const PANEL_TRANSITION = '0.35s cubic-bezier(0.16, 1, 0.3, 1)';

/** Auto-save debounce delay (milliseconds). */
export const AUTO_SAVE_DEBOUNCE_MS = 1500;

/** Duration the saved indicator stays visible before reverting to idle (ms). */
export const SAVED_DISPLAY_MS = 3000;

/** Default placeholder fallback (overridden by i18n at runtime). */
export const EDITOR_PLACEHOLDER_FALLBACK = 'Write a note...';
