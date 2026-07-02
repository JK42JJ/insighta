/**
 * CP505 — shared short label for TOC-style displays. Book chapter/section and
 * video titles run 60-84 chars; take the lead clause (before the first colon /
 * em-dash / middle-dot). Used by the left sidebar TOC and the right-panel
 * context zone so both show the SAME short label.
 */
export function tocShortLabel(title: string): string {
  return title.split(/[:：—–·|]/)[0]?.trim() || title;
}
