/**
 * Builds the one-line "why it was picked" text for a morning card.
 * Pure function over the domain only: no judge score, no pool source, no date
 * (the card already shows the upload date), no transcript, no API call.
 */

/** Max characters of the reason text shown on a card. */
export const MORNING_CARD_REASON_MAX_LENGTH = 80;

export interface ReasonInput {
  /** Korean label of the domain the card is shown under. */
  domain_label: string;
}

export function buildMorningCardReason(input: ReasonInput): string {
  const text = `${input.domain_label || '추천'} 분야 · 올해 올라온 영상`;
  return text.length > MORNING_CARD_REASON_MAX_LENGTH
    ? text.slice(0, MORNING_CARD_REASON_MAX_LENGTH - 1) + '…'
    : text;
}
