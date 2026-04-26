/**
 * VideoProvider interface — unified abstraction for video sourcing.
 *
 * Concrete providers:
 *   RedisProvider   — video-dictionary cache (fastest, pre-collected)
 *   PoolProvider    — PostgreSQL video_pool + pgvector (Tier 1 cache)
 *   YouTubeProvider — live YouTube API search (Tier 2 fallback)
 *
 * Issue: #508
 * Design: docs/design/insighta-kg-structure-audit-and-bridge-handoff.md §Phase 3
 */

import type { KeywordLanguage } from '../../v2/keyword-builder';

// ============================================================================
// Provider interface
// ============================================================================

export interface VideoProvider {
  readonly id: string;
  readonly priority: number;

  health(): Promise<ProviderHealth>;

  match(request: MatchRequest): Promise<MatchResult>;
}

// ============================================================================
// Health check
// ============================================================================

export interface ProviderHealth {
  available: boolean;
  latencyMs: number | null;
  videoCount: number | null;
  lastError: string | null;
}

// ============================================================================
// Match request / result
// ============================================================================

export interface MatchRequest {
  mandalaId: string;
  userId: string;
  cells: CellDefinition[];
  budget: number;
  excludeVideoIds: ReadonlySet<string>;
  language: KeywordLanguage;
  centerGoal: string;
  focusTags: string[];
}

export interface CellDefinition {
  cellIndex: number;
  subGoal: string;
  keywords: string[];
}

export interface MatchResult {
  candidates: VideoCandidate[];
  meta: MatchMeta;
}

export interface MatchMeta {
  source: string;
  latencyMs: number;
  candidateCount: number;
  quotaUsed: number;
}

// ============================================================================
// Video candidate (provider-agnostic)
// ============================================================================

export interface VideoCandidate {
  videoId: string;
  title: string;
  description: string | null;
  channelId: string | null;
  channelTitle: string | null;
  durationSec: number | null;
  publishedAt: Date | null;
  thumbnailUrl: string | null;
  viewCount: number | null;
  likeCount: number | null;
  relevanceScore: number;
  cellIndex: number;
  source: VideoSource;
}

export type VideoSource = 'redis' | 'pool' | 'youtube';
