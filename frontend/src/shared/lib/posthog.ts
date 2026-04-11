/**
 * PostHog Analytics — FE-only event tracking
 *
 * Initialized in main.tsx. Events are no-ops if VITE_POSTHOG_KEY is not set.
 * autocapture: false — only manual events defined here are tracked.
 */

import posthog from 'posthog-js';

const POSTHOG_KEY = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
const POSTHOG_HOST = 'https://us.i.posthog.com';

let initialized = false;

export function initPostHog(): void {
  if (!POSTHOG_KEY || initialized) return;
  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    autocapture: false,
    capture_pageview: true,
    person_profiles: 'identified_only',
  });
  initialized = true;
}

export function identifyUser(
  userId: string,
  properties?: { email?: string; created_at?: string }
): void {
  if (!initialized) return;
  posthog.identify(userId, properties);
}

export function resetUser(): void {
  if (!initialized) return;
  posthog.reset();
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
