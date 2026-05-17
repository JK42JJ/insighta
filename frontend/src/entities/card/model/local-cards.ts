/**
 * Local Cards Type Definitions
 *
 * Types for locally added scratchpad cards (URL paste, D&D)
 * stored in Supabase separately from YouTube synced videos.
 */

import type { LinkType, InsightCard, VideoSummary } from './types';

/**
 * Subscription tier types
 */
export type SubscriptionTier = 'free' | 'premium' | 'admin';

/**
 * User subscription information
 */
export interface UserSubscription {
  tier: SubscriptionTier;
  /** Card limit. `null` = unlimited (lifetime/admin tiers — see quota-policy.md). */
  limit: number | null;
  /** Mandala limit. `null` = unlimited (lifetime/admin tiers). */
  mandalaLimit: number | null;
  used: number;
}

/**
 * Local card as stored in Supabase
 */
export interface LocalCard {
  id: string;
  user_id: string;
  url: string;
  title: string | null;
  thumbnail: string | null;
  link_type: LinkType;
  user_note: string | null;
  metadata_title: string | null;
  metadata_description: string | null;
  metadata_image: string | null;
  cell_index: number;
  level_id: string;
  mandala_id: string | null;
  sort_order: number | null;
  created_at: string;
  updated_at: string;
  video_summary?: VideoSummary;
  /** YouTube upload date, joined from youtube_videos by video_id. Null for non-YouTube cards or YouTube cards not yet enriched. */
  published_at?: string | null;
  duration_seconds?: number | null;
  /** Joined from youtube_videos by video_id (CP463+ /local-cards/list LEFT JOIN extension). */
  channel_title?: string | null;
  view_count?: number | null;
  /** CP457+ pin / bookmark timestamp. Null = unpinned. */
  pinned_at?: string | null;
}

/**
 * Response from list-local-cards endpoint
 */
export interface LocalCardsResponse {
  cards: LocalCard[];
  subscription: UserSubscription;
}

/**
 * Payload for adding a new local card
 */
export interface AddLocalCardPayload {
  url: string;
  title?: string;
  thumbnail?: string;
  link_type: LinkType;
  user_note?: string;
  metadata_title?: string;
  metadata_description?: string;
  metadata_image?: string;
  cell_index?: number;
  level_id?: string;
  mandala_id?: string | null;
  sort_order?: number;
}

/**
 * Payload for updating a local card
 */
export interface UpdateLocalCardPayload {
  id: string;
  user_note?: string;
  cell_index?: number;
  level_id?: string;
  mandala_id?: string | null;
  sort_order?: number;
  title?: string;
  thumbnail?: string;
}

/**
 * Error response when limit is exceeded
 */
export interface LimitExceededError {
  error: 'LIMIT_EXCEEDED';
  message: string;
  limit: number;
  used: number;
  tier?: string;
}

/**
 * Helper function to convert LocalCard to InsightCard format
 */
export function localCardToInsightCard(card: LocalCard): InsightCard {
  const publishedAt = card.published_at ? new Date(card.published_at) : null;
  const hasMetadataTitle = !!card.metadata_title;
  const hasVideoExtras =
    card.published_at != null ||
    card.duration_seconds != null ||
    card.channel_title != null ||
    card.view_count != null;
  const metadataExtras: Record<string, unknown> = {};
  if (card.published_at) metadataExtras['published_at'] = card.published_at;
  if (card.duration_seconds != null) metadataExtras['duration_seconds'] = card.duration_seconds;
  if (card.channel_title) metadataExtras['channel_title'] = card.channel_title;
  if (card.view_count != null) metadataExtras['view_count'] = Number(card.view_count);

  return {
    id: card.id,
    videoUrl: card.url,
    title: card.title || '',
    thumbnail: card.thumbnail || '',
    userNote: card.user_note || '',
    createdAt: new Date(card.created_at),
    updatedAt: new Date(card.updated_at),
    publishedAt,
    cellIndex: card.cell_index,
    levelId: card.level_id,
    mandalaId: card.mandala_id,
    sortOrder: card.sort_order ?? undefined,
    linkType: card.link_type,
    metadata:
      hasMetadataTitle || hasVideoExtras
        ? ({
            title: card.metadata_title || card.title || '',
            description: card.metadata_description || '',
            image: card.metadata_image || '',
            siteName: '',
            author: '',
            url: card.url,
            ...metadataExtras,
          } as InsightCard['metadata'])
        : undefined,
    videoSummary: card.video_summary,
    sourceTable: 'user_local_cards',
    pinnedAt: card.pinned_at ?? null,
  };
}

/**
 * Helper function to convert InsightCard to AddLocalCardPayload
 */
export function insightCardToAddPayload(card: InsightCard): AddLocalCardPayload {
  return {
    url: card.videoUrl,
    title: card.title,
    thumbnail: card.thumbnail,
    link_type: card.linkType || 'other',
    user_note: card.userNote,
    metadata_title: card.metadata?.title,
    metadata_description: card.metadata?.description,
    metadata_image: card.metadata?.image,
    cell_index: card.cellIndex,
    level_id: card.levelId,
    mandala_id: card.mandalaId,
    sort_order: card.sortOrder,
  };
}
