/**
 * Morning cards API client (PRD #1788). Mirrors /api/v1/morning-cards routes.
 * Kept out of the shared api-client monolith; uses the same Supabase session token.
 */
import { supabase } from '@/shared/integrations/supabase/client';

export const MORNING_CARD_DOMAIN_KEYS = [
  'work_practice',
  'startup_gov_support',
  'ai_tools',
] as const;
export type MorningCardDomainKey = (typeof MORNING_CARD_DOMAIN_KEYS)[number];

export type MorningCardVerdict = 'useful' | 'skip';

export const MORNING_CARD_REASON_TAGS = [
  'off-topic',
  'outdated',
  'promotional',
  'repetitive',
  'generic',
  'low-quality',
] as const;
export type MorningCardReasonTag = (typeof MORNING_CARD_REASON_TAGS)[number];

export interface MorningCardDto {
  video_id: string;
  title: string;
  channel_name: string | null;
  /** ISO string, or null when unknown. */
  published_at: string | null;
  thumbnail_url: string | null;
  reason: string;
}

export interface MorningCardsResponse {
  domain: MorningCardDomainKey;
  cards: MorningCardDto[];
  /** True when fewer in-window cards exist than expected; never padded. */
  shortage: boolean;
}

export interface MorningCardReviewItem extends MorningCardDto {
  position: number;
  verdict: MorningCardVerdict | null;
  reason_tags: MorningCardReasonTag[];
}

export interface MorningCardsReviewResponse {
  domain: MorningCardDomainKey;
  items: MorningCardReviewItem[];
  shortage: boolean;
}

/** The only fields a judgment POST carries. */
export interface JudgmentInput {
  video_id: string;
  domain: MorningCardDomainKey;
  verdict: MorningCardVerdict;
  shown_position: number;
}

const VITE_API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';
const API_BASE_URL = VITE_API_URL.endsWith('/api') ? VITE_API_URL.slice(0, -4) : VITE_API_URL;
const MORNING_CARDS_PATH = '/api/v1/morning-cards';
const MORNING_FEED_PATH = '/api/v1/morning-feed';

export class MorningCardsApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number
  ) {
    super(message);
    this.name = 'MorningCardsApiError';
  }
}

async function call<T>(
  path: string,
  init: RequestInit = {},
  base: string = MORNING_CARDS_PATH
): Promise<T> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`;
  const res = await fetch(`${API_BASE_URL}${base}${path}`, { ...init, headers });
  if (!res.ok) {
    throw new MorningCardsApiError(`Morning cards request failed: ${res.status}`, res.status);
  }
  return (await res.json()) as T;
}

export async function fetchMorningCards(
  domain: MorningCardDomainKey
): Promise<MorningCardsResponse> {
  const res = await call<{ data: MorningCardsResponse }>(`/?domain=${encodeURIComponent(domain)}`);
  return res.data;
}

/** Saves one judgment. Body is built field by field so nothing extra is sent. */
export async function postJudgment(input: JudgmentInput): Promise<void> {
  await call<unknown>('/judgments', {
    method: 'POST',
    body: JSON.stringify({
      video_id: input.video_id,
      domain: input.domain,
      verdict: input.verdict,
      shown_position: input.shown_position,
    }),
  });
}

/** Cancels the caller's latest judgment (the row is kept and marked cancelled server-side). */
export async function undoLastJudgment(): Promise<void> {
  await call<unknown>('/judgments/last', { method: 'DELETE' });
}

/** Fixture screen only: the server answers 2xx and writes nothing. */
export async function postFixtureJudgment(input: {
  verdict: MorningCardVerdict;
  shown_position: number;
}): Promise<void> {
  await call<unknown>('/fixture-sink', { method: 'POST', body: JSON.stringify(input) });
}

/** Fixture screen only: pretend undo, nothing is written. */
export async function undoFixtureJudgment(): Promise<void> {
  await call<unknown>('/fixture-sink', { method: 'DELETE', body: JSON.stringify({}) });
}

/** Server flag status. Answers 200 even when the flag is off. */
export async function fetchMorningCardsStatus(): Promise<{ enabled: boolean }> {
  const res = await call<{ data: { enabled: boolean } }>('/status');
  return { enabled: res.data.enabled === true };
}

export async function fetchMorningCardsReview(
  domain: MorningCardDomainKey
): Promise<MorningCardsReviewResponse> {
  const res = await call<{ data: MorningCardsReviewResponse }>(
    `/review?domain=${encodeURIComponent(domain)}`
  );
  return res.data;
}

export async function patchReasonTags(input: {
  video_id: string;
  domain: MorningCardDomainKey;
  reason_tags: MorningCardReasonTag[];
}): Promise<void> {
  await call<unknown>('/judgments/reason-tags', {
    method: 'PATCH',
    body: JSON.stringify({
      video_id: input.video_id,
      domain: input.domain,
      reason_tags: input.reason_tags,
    }),
  });
}

/** Morning feed (오늘의 픽): the cards per cell, the judgment write and the undo. */
export interface FeedApiCard {
  video_id: string;
  title: string;
  channel: string | null;
  published_at: string;
  duration: number;
  view_count: number | null;
  thumbnail_url: string | null;
  cell: string;
  focus: string[];
  why: string;
  /** Optional facts about the video; every field may be missing. */
  info?: FeedApiCardInfo;
}
export interface FeedApiCardInfo {
  one_liner?: string;
  /** Reason lines joined by \n. */
  reason?: string;
  /** BCP-47-ish language code, e.g. 'ko', 'en'. */
  audio_language?: string;
  link_count?: number;
  chapters?: { sec: number; title: string }[];
}
export interface FeedApiCell {
  label: string;
  short: string;
  dom: number;
}

export interface FeedApiResponse {
  cells: FeedApiCell[];
  cards: FeedApiCard[];
  /** Watch screen: videos per day for the chosen cell, decided by the server. */
  watch_daily?: number;
  /** Watch screen: distinct videos judged today (KST) per cell label. Missing on older servers. */
  watch_today?: Record<string, number>;
}

export async function fetchMorningFeed(): Promise<FeedApiResponse> {
  const res = await call<{ data: FeedApiResponse }>('/', {}, MORNING_FEED_PATH);
  return res.data;
}

export async function postFeedJudgment(input: {
  video_id: string;
  cell: string;
  verdict: MorningCardVerdict | 'pass';
  shown_position: number;
}): Promise<void> {
  await call<unknown>(
    '/judgments',
    { method: 'POST', body: JSON.stringify(input) },
    MORNING_FEED_PATH
  );
}

export async function undoFeedJudgment(): Promise<void> {
  await call<unknown>(
    '/judgments/last',
    { method: 'DELETE', body: JSON.stringify({}) },
    MORNING_FEED_PATH
  );
}

export interface WatchProgressBody {
  video_id: string;
  /** Whole seconds actually played so far (cumulative for this card view). */
  watched_seconds: number;
  /** Whole seconds: where the playhead is. */
  last_position: number;
}

/** Fire-and-forget progress write. Never throws: the screen must not depend on it. */
export async function postWatchProgress(body: WatchProgressBody): Promise<void> {
  try {
    await call<unknown>(
      '/watch',
      {
        method: 'POST',
        keepalive: true,
        body: JSON.stringify({
          video_id: body.video_id,
          watched_seconds: body.watched_seconds,
          last_position: body.last_position,
        }),
      },
      MORNING_FEED_PATH
    );
  } catch {
    /* progress is best effort */
  }
}

export type InsightVerdict = 'useful' | 'skip' | 'pass';
export interface InsightOrderItem {
  video_id: string;
  title: string;
  verdict: InsightVerdict;
  cell: string;
  duration_seconds: number;
  watched_seconds: number | null;
  at: string;
}
export interface InsightByCell {
  cell: string;
  count: number;
  watched_seconds: number | null;
}
export interface InsightData {
  date_kst: string;
  reacted: number;
  liked: number;
  disliked: number;
  passed: number;
  watched_seconds_total: number | null;
  has_watch_data: boolean;
  by_cell: InsightByCell[];
  order: InsightOrderItem[];
}
export interface InsightResponse {
  status: 'ok';
  data: InsightData;
}

/** Today's summary; with `cell` only that cell's (goal's) judgments are counted. */
export async function fetchMorningFeedInsight(cell?: string): Promise<InsightData> {
  const query = cell === undefined ? '' : '?cell=' + encodeURIComponent(cell);
  const res = await call<InsightResponse>('/insight' + query, {}, MORNING_FEED_PATH);
  return res.data;
}
