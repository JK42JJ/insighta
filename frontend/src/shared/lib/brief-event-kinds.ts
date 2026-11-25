/**
 * Brief behaviour events (work order D1, 2026-11-25). The same names are stored by our API (the
 * source of truth) and sent to PostHog. Same list as the server's BRIEF_EVENT_KINDS
 * (src/modules/morning-feed/brief-usage.ts).
 */
export const BRIEF_EVENT_KINDS = [
  'headline_view',
  'headline_select',
  'read_depth',
  'sentence_tap',
  // the source sheet (2026-11-25 B5-2): opened (value = where), base <-> bar (value = form_how), closed
  'sheet_open',
  'sheet_form',
  'sheet_close',
  'play_range',
  'video_full',
  'reaction',
  'share',
  'suggest',
  'field_switch',
  'past_open',
  'other_fields_view',
  'other_field_select',
] as const;
export type BriefEventKind = (typeof BRIEF_EVENT_KINDS)[number];
