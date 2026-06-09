export type LinkType =
  | 'youtube'
  | 'youtube-shorts'
  | 'youtube-playlist'
  | 'linkedin'
  | 'facebook'
  | 'notion'
  | 'txt'
  | 'md'
  | 'pdf'
  | 'other';

export interface UrlMetadata {
  title: string;
  description: string;
  image: string;
  siteName: string;
  author: string;
  url: string;
}

export interface VideoSummary {
  summary_en: string;
  summary_ko: string;
  tags: string[];
  model: string;
}

/** @deprecated Use ContentEntity from '@/entities/content' instead. Will be removed after migration. */
export interface InsightCard {
  id: string;
  videoUrl: string; // keeping name for backward compatibility, but represents any URL
  title: string;
  thumbnail: string;
  userNote: string;
  createdAt: Date;
  updatedAt?: Date;
  /** Source-material publish date (YouTube upload, article date), NOT createdAt. */
  publishedAt?: Date | null;
  cellIndex: number;
  levelId: string; // Which mandala level this card belongs to
  mandalaId?: string | null; // Which mandala this card belongs to
  sortOrder?: number;
  linkType?: LinkType;
  metadata?: UrlMetadata; // OG metadata for external links
  lastWatchPosition?: number; // Last playback position in seconds (for YouTube videos)
  isInIdeation?: boolean; // Whether the card is in ideation (scratchpad) or mandala grid
  videoSummary?: VideoSummary; // Central video summary from video_summaries table
  sourceTable?: 'user_local_cards' | 'user_video_states'; // Origin table for enrichment routing
  /**
   * CP457+ pin/bookmark state. ISO string when pinned, null/undefined when not.
   * Surfaced from `pinned_at` column on the source table. Toggled via
   * `usePinCard` mutation hitting `PATCH /api/v1/cards/:id/pin`.
   */
  pinnedAt?: string | null;
  /**
   * CP474 — true when the underlying row was inserted by the auto-add
   * recommendation pipeline (not the YouTube sync engine). Used by the
   * "New Cards" tab predicate to suppress auto-added rows so the tab
   * only surfaces genuinely-synced YouTube content. Surfaced from the
   * `auto_added` column on `user_video_states` (always `false` for
   * `user_local_cards` rows, which the predicate ignores anyway).
   */
  autoAdded?: boolean;
  /**
   * CP475+ — v2 rich-summary fields folded into the same /local-cards/list
   * response so the grid renders once with all fields present (eliminates
   * the second-stage useV2Summaries arrival that previously caused a
   * 1-second swap on the dashboard).
   */
  v2OneLiner?: string | null;
  v2CoreArgument?: string | null;
  v2MandalaRelevancePct?: number | null;
  v2QualityFlag?: string | null;
  v2FullLanded?: boolean;
  /**
   * CP498 PR3c — A-stage relevance score (0-100), USER-SCOPED (the per-row
   * relevance_pct on user_video_states / user_local_cards). Distinct from
   * v2MandalaRelevancePct above, which is the video-keyed (cross-user-leaky)
   * column — never use that for sorting. Null = not yet backfilled; drives the
   * optional "관련도순" sort (NULLS LAST).
   */
  relevancePct?: number | null;
  /**
   * CP475+ — true only when the BE has every foundational field the grid
   * card needs (published_at, duration_seconds for YouTube). False = the
   * youtube_videos pipeline is still catching up; the FE renders the row
   * as a skeleton until a subsequent refetch flips this to true. Always
   * true for non-YouTube cards (no metadata pipeline).
   */
  metadataComplete?: boolean;
}

export interface MandalaLevel {
  id: string;
  centerGoal: string;
  /** Short label for center goal. Falls back to centerGoal when missing. */
  centerLabel?: string | null;
  subjects: string[];
  /** Short labels parallel to `subjects`. Falls back to subjects when missing. */
  subjectLabels?: string[];
  parentId: string | null;
  parentCellIndex: number | null;
  cards: InsightCard[];
}

export interface MandalaPath {
  id: string;
  label: string;
}
