/**
 * Builds the short "why it was picked" text for a morning card.
 * Pure function over existing pool fields only (no transcript, no API call).
 */

/** Max characters of the reason text shown on a card. */
export const MORNING_CARD_REASON_MAX_LENGTH = 80;

export interface ReasonInput {
  relevance_score: number;
  source: string;
  published_at: Date | null;
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function buildMorningCardReason(input: ReasonInput): string {
  const score = Number.isFinite(input.relevance_score) ? input.relevance_score.toFixed(2) : '-';
  const parts = [`관련도 ${score}`, `출처 ${input.source || '-'}`];
  if (input.published_at instanceof Date && !Number.isNaN(input.published_at.getTime())) {
    parts.push(`${formatDate(input.published_at)} 업로드`);
  }
  const text = parts.join(' · ');
  return text.length > MORNING_CARD_REASON_MAX_LENGTH
    ? text.slice(0, MORNING_CARD_REASON_MAX_LENGTH - 1) + '…'
    : text;
}
