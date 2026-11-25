/**
 * PostHog Analytics — FE-only event tracking
 *
 * Initialized in main.tsx. Events are no-ops if VITE_POSTHOG_KEY is not set.
 * autocapture: false — only manual events defined here are tracked.
 */

import posthog from 'posthog-js';

const POSTHOG_KEY = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
const POSTHOG_HOST = 'https://us.i.posthog.com';
/**
 * Session replay for the usability test: '1' = record signed-in people (non-secret build flag).
 * Anything else = the behaviour without it. Input masking stays PostHog's default (all inputs).
 */
const REPLAY_BUILD = import.meta.env.VITE_POSTHOG_REPLAY === '1';
/** Last day of recording (KST, 'YYYY-MM-DD'): the plan's free allowance ends then (James 2026-11-25). */
const REPLAY_UNTIL = (import.meta.env.VITE_POSTHOG_REPLAY_UNTIL as string | undefined) ?? '';
/** Accounts that are never recorded (user ids, not emails): James's and the deploy test's (James 2026-11-25). */
const REPLAY_EXCLUDE: ReadonlySet<string> = new Set(
  String(import.meta.env.VITE_POSTHOG_REPLAY_EXCLUDE ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
);
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * Whether this visit may be recorded: a replay build, not past the last day, and not an automated
 * browser (the deploy's own tests would use up the allowance).
 */
export function replayAllowed(
  now: Date,
  automated: boolean,
  build = REPLAY_BUILD,
  until = REPLAY_UNTIL
): boolean {
  if (!build || automated || !/^\d{4}-\d{2}-\d{2}$/.test(until)) return false;
  return new Date(now.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10) <= until;
}
const REPLAY_ON = replayAllowed(
  new Date(),
  typeof navigator !== 'undefined' && navigator.webdriver === true
);
/** The replay address points this many seconds before the moment it is asked for. */
const REPLAY_LOOK_BACK_S = 10;

/** What a replay build may send: the recording and who it is. Product events stay prod's. */
const REPLAY_EVENTS: ReadonlySet<string> = new Set(['$snapshot', '$identify', '$set']);
export function onlyReplay<T extends { event: string }>(e: T | null): T | null {
  return e && REPLAY_EVENTS.has(e.event) ? e : null;
}

let initialized = false;

export function initPostHog(): void {
  if (!POSTHOG_KEY || initialized) return;
  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    autocapture: false,
    // a replay build shares the project with prod: it sends recordings and their user id only
    capture_pageview: !REPLAY_BUILD,
    person_profiles: 'identified_only',
    // recording starts in identifyUser, so nothing is recorded before sign-in
    ...(REPLAY_BUILD ? { disable_session_recording: true, before_send: onlyReplay } : {}),
  });
  initialized = true;
}

export function identifyUser(
  userId: string,
  properties?: { email?: string; created_at?: string }
): void {
  if (!initialized) return;
  if (!REPLAY_BUILD) {
    posthog.identify(userId, properties);
    return;
  }
  if (!REPLAY_ON || REPLAY_EXCLUDE.has(userId)) return;
  // recorded sessions carry the user id only: no email or other properties
  posthog.identify(userId);
  if (!posthog.sessionRecordingStarted()) {
    // true: every signed-in person, whatever the project's sampling or triggers say
    posthog.startSessionRecording(true);
  }
}

export function resetUser(): void {
  if (!initialized) return;
  if (REPLAY_ON) posthog.stopSessionRecording();
  posthog.reset();
}

/** The address of the running session recording, a few seconds back; null when none is running. */
export function getReplayUrl(): string | null {
  if (!initialized || !REPLAY_ON) return null;
  try {
    if (!posthog.sessionRecordingStarted()) return null;
    const url = posthog.get_session_replay_url({
      withTimestamp: true,
      timestampLookBack: REPLAY_LOOK_BACK_S,
    });
    return url || null;
  } catch {
    return null;
  }
}

// ─── Event helpers ───

export function trackMandalaCreated(props: {
  mandala_id: string;
  template_id?: string;
  language: string;
}): void {
  if (!initialized) return;
  posthog.capture('mandala_created', props);
}

export function trackCardAdded(props: {
  mandala_id?: string;
  cell_index?: number;
  source: 'manual' | 'auto_recommend' | 'youtube_sync';
}): void {
  if (!initialized) return;
  posthog.capture('card_added', props);
}

export function trackCardViewed(props: {
  mandala_id?: string;
  card_id: string;
  has_summary: boolean;
}): void {
  if (!initialized) return;
  posthog.capture('card_viewed', props);
}

export function trackRecommendationFeedback(props: {
  mandala_id: string;
  card_id: string;
  action: 'accept' | 'reject' | 'skip';
  domain?: string;
}): void {
  if (!initialized) return;
  posthog.capture('recommendation_feedback', props);
}

export function trackSkillActivated(props: { mandala_id: string; skill_type: string }): void {
  if (!initialized) return;
  posthog.capture('skill_activated', props);
}
