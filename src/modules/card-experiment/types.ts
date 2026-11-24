import type { YouTubeVideoFullMetadata } from '@/skills/plugins/video-discover/v2/youtube-client';

export type { YouTubeVideoFullMetadata };

/** Filter names, in evaluation order. */
export const FILTER_NAMES = [
  'ingest_quality_gate',
  'shorts_duration_75',
  'shorts_title',
  'title_blocklist',
  'off_language_title',
  'not_embeddable',
  'live_or_upcoming',
  'age_restricted',
  'channel_blocked',
  'relevance_cut',
] as const;

export type FilterName = (typeof FILTER_NAMES)[number];

export type FailureValue = string | number | boolean | null;

export interface FilterFailure {
  filter: FilterName;
  /** Measured value that failed (reason string for ingest gate). */
  value: FailureValue;
  /** Threshold / rule it was compared against. */
  threshold: FailureValue;
}

export interface CandidateMargins {
  durationSec: number | null;
  viewCount: number | null;
  ageDays: number | null;
  /** Best-cell cosine; null when not computed or embedding failed. */
  cosine: number | null;
  titleLen: number;
}

export interface RelevanceInfo {
  /** Best-cell cosine; null = embedding failed. */
  cosine: number | null;
  threshold: number;
}

export interface GateContext {
  now: Date;
  blockedChannelIds?: ReadonlySet<string>;
  blockedChannelNames?: ReadonlySet<string>;
  /** Omit to skip the relevance_cut filter. */
  relevance?: RelevanceInfo | null;
}

export interface CandidateEvaluation {
  pass: boolean;
  failures: FilterFailure[];
  firstFailure: FilterFailure | null;
  margins: CandidateMargins;
}

export interface CapItem {
  videoId: string;
  cell?: string | null;
  channelId?: string | null;
}

export interface CapResult<T extends CapItem> {
  item: T;
  capped: boolean;
  flag: string | null;
}

export interface SheetAssertionResult {
  pass: boolean;
  checks: {
    duration: boolean;
    notShorts: boolean;
    embeddable: boolean;
    language: boolean;
  };
  failed: string[];
  /** true when audio lang is in RESCUE_AUDIO_LANGS but the Hangul rule passes. */
  lang_rescue: boolean;
}

export interface RelevanceScore {
  cosine: number | null;
  bestCell: string | null;
}

export interface ExperimentItem {
  videoId: string;
  cell?: string | null;
}

export interface ExperimentResult {
  videoId: string;
  cell: string | null;
  found: boolean;
  pass: boolean;
  failures: FilterFailure[];
  firstFailure: FilterFailure | null;
  margins: CandidateMargins | null;
  bestCell: string | null;
  capped: boolean;
  capFlag: string | null;
  /** pass AND not capped. */
  finalPass: boolean;
}

export interface FunnelStep {
  filter: FilterName | 'channel_cap';
  /** Candidates removed here (first failing filter, in order). */
  removed: number;
  remaining: number;
}

export interface Funnel {
  total: number;
  found: number;
  notFound: number;
  /** Count of candidates failing each filter (a candidate can fail several). */
  failedByFilter: Record<FilterName, number>;
  /** Sequential attrition by first failure, then the cell/channel cap. */
  sequential: FunnelStep[];
  capped: number;
  finalPass: number;
}

export interface ExperimentOutput {
  results: ExperimentResult[];
  funnel: Funnel;
}
