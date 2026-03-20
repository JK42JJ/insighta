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
  limit: number;
  mandalaLimit: number;
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
  return {
    id: card.id,
    videoUrl: card.url,
    title: card.title || '',
    thumbnail: card.thumbnail || '',
    userNote: card.user_note || '',
    createdAt: new Date(card.created_at),
    cellIndex: card.cell_index,
    levelId: card.level_id,
    mandalaId: card.mandala_id,
    sortOrder: card.sort_order ?? undefined,
    linkType: card.link_type,
    metadata: card.metadata_title
      ? {
          title: card.metadata_title,
          description: card.metadata_description || '',
          image: card.metadata_image || '',
          siteName: '',
          author: '',
          url: card.url,
        }
      : undefined,
    videoSummary: card.video_summary,
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
