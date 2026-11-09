/**
 * Measurement record types (SHADOW MODE). Comment text is never part of any
 * recorded structure — only counts.
 */

export type MeasurementBranch = 'track1' | 'track2';
export type SourceKind = 'search_keyword' | 'llm_gemini' | 'llm_sonar' | 'chart' | 'other';

/** Minimal local view of a videos.list item (snippet/contentDetails/statistics). */
export interface VideoItemLike {
  id?: string;
  snippet?: {
    title?: string;
    description?: string;
    publishedAt?: string;
    channelId?: string;
  };
  contentDetails?: {
    duration?: string; // ISO 8601
    caption?: string; // 'true' | 'false'
    definition?: string; // 'hd' | 'sd'
  };
  statistics?: {
    viewCount?: string;
    likeCount?: string;
    commentCount?: string;
  };
}

export interface TitleShape {
  has_number: boolean;
  has_howto: boolean;
  has_exaggeration: boolean;
  emoji_count: number;
  has_bracket: boolean;
}

export interface VideoFeatures {
  age_days: number | null;
  duration_sec: number | null;
  chapter_count: number;
  has_caption: boolean;
  definition: string | null;
  description_length: number;
  title_shape: TitleShape;
}

export interface ReactionFeatures {
  view_count: number | null;
  views_per_day: number | null;
  like_count: number | null;
  comment_count: number | null;
  like_per_view: number | null;
  comment_per_view: number | null;
}

export interface ChannelFeatures {
  /** null when the channel hides its subscriber count. */
  subscriber_count: number | null;
  channel_age_days: number | null;
  channel_video_count: number | null;
  upload_cadence_days: number | null;
  shorts_ratio_last50: number | null;
  /** Threshold used for the shorts ratio (SHORT_MAX_DURATION_SEC). */
  shorts_threshold_sec: number;
  views_multiple_vs_channel_median: number | null;
}

export interface CommentSignals {
  positive_count: number;
  negative_count: number;
  sampled: number;
  disabled: boolean;
}

export interface FilterTraceEntry {
  filter: string;
  value: unknown;
  threshold: unknown;
}

export interface SourceInfo {
  cell: string | null;
  branch: MeasurementBranch;
  source_kind: SourceKind;
  keyword: string | null;
  discovery_paths: number;
}

/** Row handed to the writer (maps 1:1 to candidate_features). */
export interface MeasurementRecord {
  runId: string;
  branch: MeasurementBranch;
  videoId: string;
  cell?: string | null;
  sourceKind?: SourceKind | null;
  keyword?: string | null;
  discoveryPaths?: number | null;
  video?: VideoFeatures | null;
  reaction?: ReactionFeatures | null;
  channel?: ChannelFeatures | null;
  commentSignals?: CommentSignals | null;
  filterTrace?: FilterTraceEntry[] | null;
  relevanceScore?: number | null;
}

/** YouTube API units spent by the measurement fetches. */
export interface UnitsUsed {
  channels: number;
  playlistItems: number;
  videos: number;
}

export type FetchFn = (url: string) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;
