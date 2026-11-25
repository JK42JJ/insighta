import { sendFeedEvent } from '@/features/morning-cards/api';
import { supabase } from '@/shared/integrations/supabase/client';
import { type BriefEventKind } from '@/shared/lib/brief-event-kinds';
import { captureBriefEvent } from '@/shared/lib/posthog';

/*
 * What a reader does in a brief, down to the sentence (work order D1, 2026-11-25). Our API is the
 * source of truth; PostHog gets the same event under the same name. An event is written to the
 * phone first and taken off when the server has it, so a lost request or a closed page only delays
 * it: what is left is sent on the next event, on coming back online or at the next visit. The
 * server keeps an event id once, so sending again never counts twice. The user id is the only thing
 * that names a person (the server takes it from the sign-in).
 */

export interface BriefEventData {
  /** The brief's field (goal cell label); with `seenDate` it names the brief. */
  cell?: string;
  /** 'YYYY-MM-DD' */
  seenDate?: string;
  /** brief-sentences.ts: p<paragraph>.s<sentence> */
  sentenceId?: string;
  videoId?: string;
  /** Short token: letters, digits, _ and -, at most 16 (a verdict, where, how). */
  value?: string;
  /** Field left and field gone to (goal cell labels). */
  from?: string;
  to?: string;
  /** Seconds of the video played, whole or not. */
  startSec?: number;
  endSec?: number;
  paragraph?: number;
}

interface Kept {
  /** Who did it; null until the sign-in has been read once. */
  user: string | null;
  body: Record<string, string | number>;
}

export const BRIEF_EVENTS_KEY = 'insighta-brief-events';
/** Events kept on the phone while the network is away; the oldest go first. */
const KEPT_MAX = 300;
/** Requests at a time when many are left from an earlier visit. */
const AT_ONCE = 8;
/** The server believes the phone's time this far back; older events are dropped. */
const KEPT_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

let kept: Map<string, Kept> | null = null;
const onTheWay = new Set<string>();
let listening = false;
/** Who is signed in, once known (an event can then be kept even if the page closes at once). */
let knownUser: string | null = null;

function load(): Map<string, Kept> {
  if (kept) return kept;
  kept = new Map();
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(BRIEF_EVENTS_KEY) ?? '[]');
    if (Array.isArray(raw)) {
      for (const k of raw as Kept[]) {
        const id = k?.body?.id;
        // without a user it cannot be told whose it was
        const fresh = Date.now() - Date.parse(String(k?.body?.at)) < KEPT_DAYS * MS_PER_DAY;
        if (typeof id === 'string' && typeof k.user === 'string' && fresh) kept.set(id, k);
      }
    }
  } catch {
    /* unreadable store: start again */
  }
  return kept;
}

function save(): void {
  try {
    const all = [...load().values()];
    if (all.length === 0) localStorage.removeItem(BRIEF_EVENTS_KEY);
    else localStorage.setItem(BRIEF_EVENTS_KEY, JSON.stringify(all));
  } catch {
    /* no storage (private mode): the events are still sent from memory */
  }
}

function newId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // randomUUID needs a secure context; the id only has to be unique and shaped like a UUID
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** False when the network or the server is not taking events now. */
async function sendOne(id: string): Promise<boolean> {
  const item = load().get(id);
  if (!item || onTheWay.has(id)) return true;
  onTheWay.add(id);
  try {
    if (item.user === null) {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.user?.id) {
        load().delete(id); // nobody is signed in: nobody's event
        return true;
      }
      knownUser = session.user.id;
      item.user = knownUser;
      save();
    }
    const result = await sendFeedEvent(item.body, item.user);
    if (result === 'sent' || result === 'refused') load().delete(id);
    return result !== 'failed';
  } catch {
    return false; // kept for the next try
  } finally {
    onTheWay.delete(id);
    save();
  }
}

/** Sends what is kept, `first` at once and the older ones a few at a time. */
async function flush(first?: string): Promise<void> {
  if (first && !(await sendOne(first))) return;
  const rest = [...load().keys()].filter((id) => !onTheWay.has(id));
  for (let i = 0; i < rest.length; i += AT_ONCE) {
    const ok = await Promise.all(rest.slice(i, i + AT_ONCE).map(sendOne));
    if (ok.includes(false)) return;
  }
}

function listen(): void {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  window.addEventListener('online', () => void flush());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void flush();
  });
  // another account in the same tab: its events are its own
  supabase.auth.onAuthStateChange?.((_event, session) => {
    knownUser = session?.user?.id ?? null;
  });
}

function wholeSeconds(v: number | undefined): number | undefined {
  return v !== undefined && Number.isFinite(v) && v >= 0 ? Math.floor(v) : undefined;
}

/** Records one brief event. Returns at once and never throws: the screen must not depend on it. */
export function recordBriefEvent(kind: BriefEventKind, data: BriefEventData = {}): void {
  try {
    const fields: Record<string, string | number | undefined> = {
      cell: data.cell,
      date: data.seenDate,
      sentence_id: data.sentenceId,
      video_id: data.videoId,
      value: data.value,
      from: data.from,
      to: data.to,
      start_sec: wholeSeconds(data.startSec),
      end_sec: wholeSeconds(data.endSec),
      paragraph: data.paragraph,
    };
    const given: Record<string, string | number> = {};
    for (const [k, v] of Object.entries(fields)) if (v !== undefined) given[k] = v;

    const id = newId();
    const all = load();
    all.set(id, {
      user: knownUser,
      body: { kind, ...given, id, at: new Date().toISOString() },
    });
    while (all.size > KEPT_MAX) all.delete(all.keys().next().value as string);
    save();
    void flush(id);
    listen();
    captureBriefEvent(kind, given);
  } catch {
    /* usage events are best effort */
  }
}
