/**
 * "Complete v2" predicate — mirrors the full generator's skip-gate definition
 * (rich-summary-v2-generator.ts: template_version==='v2' && mandala_relevance_pct
 * != null && transcript_used). A complete row is an atom-bearing, transcript-
 * grounded v2 in the GLOBAL cache (video_rich_summaries.video_id PK), so the
 * on-demand enrich handler short-circuits on it instead of re-calling Haiku+Sonnet.
 */
export interface V2CompletenessRow {
  template_version?: string | null;
  transcript_used?: boolean | null;
  mandala_relevance_pct?: number | null;
}

export function isCompleteV2(row: V2CompletenessRow | null | undefined): boolean {
  return (
    !!row &&
    row.template_version === 'v2' &&
    row.transcript_used === true &&
    row.mandala_relevance_pct != null
  );
}
