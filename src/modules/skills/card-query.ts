/**
 * Unified Card Query — Single source of truth for skill card access
 *
 * ALL skills MUST use this module to query cards. Direct table queries
 * in individual skills are forbidden — they cause data source drift
 * (e.g., newsletter querying only synced cards while report queries both).
 *
 * Data sources: user_local_cards (primary) + user_video_states (synced YouTube)
 */

import { Prisma } from '@prisma/client';
import { getPrismaClient } from '@/modules/database';

/** Unified card representation across all data sources */
export interface SkillCard {
  id: string;
  title: string | null;
  url: string | null;
  thumbnail_url: string | null;
  cell_index: number;
  channel_title: string | null;
  one_liner: string | null;
  structured: unknown;
  quality_score: number | null;
  quality_flag: string | null;
  source: 'local' | 'synced';
  created_at: Date;
}

export interface CardQueryOptions {
  userId: string;
  mandalaId: string;
  /** Only include cards from these cells (null = all cells) */
  cellScope?: number[] | null;
  /** Only include cards created after this date (null = no date filter) */
  since?: Date | null;
  /** Maximum number of cards to return */
  limit: number;
}

/**
 * Query all cards for a mandala from both local and synced sources.
 * Returns unified SkillCard[] sorted by created_at DESC.
 */
export async function queryMandalaCards(opts: CardQueryOptions): Promise<SkillCard[]> {
  const { userId, mandalaId, cellScope = null, since = null, limit } = opts;
  const db = getPrismaClient();

  // 1. Local cards (primary data source)
  const localCards = await db.user_local_cards.findMany({
    where: {
      user_id: userId,
      mandala_id: mandalaId,
      cell_index: cellScope ? { in: cellScope } : { gte: 0 },
      ...(since ? { created_at: { gte: since } } : {}),
    },
    select: {
      id: true,
      title: true,
      url: true,
      cell_index: true,
      created_at: true,
    },
    orderBy: { created_at: 'desc' },
    take: limit,
  });

  // 2. Synced YouTube cards with rich summaries
  const syncedCards = await db.$queryRaw<SyncedCardRow[]>`
    SELECT
      uvs.id::text AS id,
      yv.title,
      CONCAT('https://youtube.com/watch?v=', yv.youtube_video_id) AS url,
      yv.thumbnail_url,
      uvs.cell_index,
      yv.channel_title,
      vrs.one_liner,
      vrs.structured,
      vrs.quality_score,
      vrs.quality_flag,
      uvs.created_at
    FROM user_video_states uvs
    JOIN youtube_videos yv ON yv.id = uvs.video_id
    LEFT JOIN video_rich_summaries vrs ON vrs.video_id = yv.youtube_video_id
    WHERE uvs.user_id = ${userId}::uuid
      AND uvs.mandala_id = ${mandalaId}::uuid
      AND uvs.cell_index >= 0
      AND uvs.is_in_ideation = false
      ${cellScope ? Prisma.sql`AND uvs.cell_index = ANY(${cellScope}::int[])` : Prisma.empty}
      ${since ? Prisma.sql`AND uvs.created_at >= ${since}` : Prisma.empty}
    ORDER BY uvs.created_at DESC
    LIMIT ${limit}
  `;

  // 3. Merge into unified format
  const merged: SkillCard[] = [
    ...localCards.map((c) => ({
      id: c.id,
      title: c.title,
      url: c.url,
      thumbnail_url: null,
      cell_index: c.cell_index ?? 0,
      channel_title: c.url ? safeHostname(c.url) : null,
      one_liner: null,
      structured: null,
      quality_score: null,
      quality_flag: null,
      source: 'local' as const,
      created_at: c.created_at ?? new Date(),
    })),
    ...syncedCards.map((c) => ({
      id: c.id,
      title: c.title,
      url: c.url,
      thumbnail_url: c.thumbnail_url,
      cell_index: c.cell_index,
      channel_title: c.channel_title,
      one_liner: c.one_liner,
      structured: c.structured,
      quality_score: c.quality_score,
      quality_flag: c.quality_flag,
      source: 'synced' as const,
      created_at: c.created_at,
    })),
  ];

  // Sort by date descending, take limit
  merged.sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
  return merged.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface SyncedCardRow {
  id: string;
  title: string | null;
  url: string | null;
  thumbnail_url: string | null;
  cell_index: number;
  channel_title: string | null;
  one_liner: string | null;
  structured: unknown;
  quality_score: number | null;
  quality_flag: string | null;
  created_at: Date;
}

function safeHostname(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}
