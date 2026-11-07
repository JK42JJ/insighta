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

export class MorningCardsApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number
  ) {
    super(message);
    this.name = 'MorningCardsApiError';
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`;
  const res = await fetch(`${API_BASE_URL}${MORNING_CARDS_PATH}${path}`, { ...init, headers });
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
