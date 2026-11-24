/*
 * Landing page usage (decision 2026-11-24, option A): a signed-out visitor's events are kept in
 * this tab (sessionStorage) and sent with the existing usage API only after Google sign-in, on
 * arrival at the brief screen, together with login_done. Nothing personal is stored: kinds and a
 * short value only. sessionStorage survives the Google round trip in the same tab (the return
 * target `auth-return-to` relies on the same).
 */

export type LandingEventKind =
  | 'landing_open'
  | 'landing_scroll_step3'
  | 'start_click'
  | 'add_click';
/** Which Google button: the bar fixed at the bottom or the one in the last section. */
export type StartButton = 'sticky' | 'final';
/** How the visitor left for sign-in: a Google button or ADD (shows the 곧 출시 notice after). */
export type LandingEntry = 'google' | 'add';

export interface LandingEvent {
  kind: LandingEventKind;
  value?: string;
}

export interface LandingArrival {
  entry: LandingEntry;
  events: LandingEvent[];
}

export const LANDING_EVENTS_KEY = 'insighta-landing-events';
export const LANDING_ARRIVAL_KEY = 'insighta-landing-arrival';
/** A sign-in that left the landing but never came back (cancelled at Google) stops counting after this. */
export const LANDING_ARRIVAL_MAX_MS = 15 * 60 * 1000;
/** Kept at most; repeated taps beyond this are not kept. */
export const LANDING_EVENTS_MAX = 20;
/** Recorded once per visit (tab). */
const ONCE: ReadonlySet<LandingEventKind> = new Set(['landing_open', 'landing_scroll_step3']);
const KINDS: ReadonlySet<string> = new Set<LandingEventKind>([
  'landing_open',
  'landing_scroll_step3',
  'start_click',
  'add_click',
]);

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function isLandingEvent(x: unknown): x is LandingEvent {
  if (typeof x !== 'object' || x === null) return false;
  const e = x as Record<string, unknown>;
  return (
    KINDS.has(e['kind'] as string) && (e['value'] === undefined || typeof e['value'] === 'string')
  );
}

export function readLandingEvents(): LandingEvent[] {
  const s = storage();
  if (!s) return [];
  try {
    const raw: unknown = JSON.parse(s.getItem(LANDING_EVENTS_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter(isLandingEvent) : [];
  } catch {
    return [];
  }
}

/** Keeps one event in this tab (once-kinds only the first time). Never throws. */
export function recordLandingEvent(kind: LandingEventKind, value?: StartButton): void {
  const s = storage();
  if (!s) return;
  const list = readLandingEvents();
  if (ONCE.has(kind) && list.some((e) => e.kind === kind)) return;
  if (list.length >= LANDING_EVENTS_MAX) return;
  list.push(value === undefined ? { kind } : { kind, value });
  try {
    s.setItem(LANDING_EVENTS_KEY, JSON.stringify(list));
  } catch {
    /* storage full or blocked: the event is lost */
  }
}

/** The visitor is leaving for Google sign-in from the landing. */
export function markLandingSignIn(entry: LandingEntry): void {
  try {
    storage()?.setItem(LANDING_ARRIVAL_KEY, `${entry}:${Date.now()}`);
  } catch {
    /* storage blocked: the arrival is not recognised (onboarding shows as for anyone) */
  }
}

/** The pending arrival from the landing, without consuming it. */
export function peekLandingArrival(): LandingEntry | null {
  try {
    const raw = storage()?.getItem(LANDING_ARRIVAL_KEY) ?? '';
    const [v, at] = raw.split(':');
    const fresh = Date.now() - Number(at) <= LANDING_ARRIVAL_MAX_MS;
    if (!fresh && raw) storage()?.removeItem(LANDING_ARRIVAL_KEY); // cancelled long ago: not a landing arrival
    return fresh && (v === 'google' || v === 'add') ? v : null;
  } catch {
    return null;
  }
}

/** The pending arrival and the kept events, removed from the tab (only the first call gets them). */
export function takeLandingArrival(): LandingArrival | null {
  const entry = peekLandingArrival();
  if (!entry) return null;
  const events = readLandingEvents();
  try {
    storage()?.removeItem(LANDING_ARRIVAL_KEY);
    storage()?.removeItem(LANDING_EVENTS_KEY);
  } catch {
    /* blocked: nothing more to do */
  }
  return { entry, events };
}
