/**
 * Reuse loop (CP494, keystone) — return v5 live-discovered picks to video_pool.
 *
 * v5 (wizard + add-cards) discovers videos via live search.list but never wrote
 * them back to the pool (DIAG7a), so user A's discovery vanished and user B
 * re-searched → user↑ = API↑ linear. This closes the loop: the PICKED cards
 * (LLM-chosen, videos.list-enriched = full metadata) are upserted to video_pool
 * with source='user_live' so the next request's pool-first match reuses them.
 *
 * Scope (CP494 decisions):
 *   - picked only (survivors are search snippet, no view/duration → can't quality-gate).
 *   - source='user_live' (user_* convention; provenance distinct → reuse contribution
 *     is measurable). Consumer (v5 poolSources) reads it ONLY when V5_REUSE_LOOP=on.
 *   - embeddings deferred (tsvector(title/desc) matches immediately; dense rerank
 *     via a later embed backfill). No embedding write here.
 *   - blast radius: upsert keyed by video_id; update NEVER overwrites source
 *     (preserves a more-authoritative existing source like v2_promoted), only
 *     refreshes freshness + revives (is_active) + restores scrubbed title/desc.
 *   - fire-and-forget at the call site → zero hot-path impact (12s add-cards cap).
 *
 * Flag-gated by V5_REUSE_LOOP (default off → no write, current behavior).
 */

import { Prisma } from '@prisma/client';
import { classifyQuality } from '@/skills/plugins/batch-video-collector/quality';
import { shortGateFields } from '@/modules/video-pool/is-short';
import { getPrismaClient } from '@/modules/database/client';
import { MS_PER_DAY } from '@/utils/time-constants';
import { logger } from '@/utils/logger';

const log = logger.child({ module: 'video-pool/reuse-from-v5' });

export const REUSE_SOURCE = 'user_live';
const TTL_DAYS = 30;
const ttlFromNow = () => new Date(Date.now() + TTL_DAYS * MS_PER_DAY);

/** Minimal picked-card shape (structural — avoids importing V5Card from executor). */
export interface ReuseCard {
  videoId: string;
  title: string;
  channelTitle: string;
  channelId: string;
  thumbnailUrl: string;
  publishedAt: string | null;
  durationSec: number | null;
  viewCount: number | null;
}

export interface ReuseInput {
  cards: ReadonlyArray<ReuseCard>;
  /** survivor fanout candidates (carry description that V5Card drops). */
  fanoutById: Map<string, { description?: string | null }>;
  /** videos.list full metadata (carries like_count that V5Card drops). */
  metaById: Map<string, { statistics?: { likeCount?: string } }>;
  language: 'ko' | 'en';
}

interface ShortGate {
  is_short?: boolean;
  short_signal?: string;
  short_probed_at?: Date;
}

/** Explicit row shapes (named fields → dot-accessible in tests; cast to Prisma at upsert). */
export interface ReuseCreate extends ShortGate {
  video_id: string;
  title: string;
  description: string | null;
  channel_name: string | null;
  channel_id: string | null;
  view_count: bigint;
  like_count: bigint;
  duration_seconds: number | null;
  published_at: Date | null;
  thumbnail_url: string | null;
  language: string;
  quality_tier: string;
  source: string;
  is_active: boolean;
  expires_at: Date;
}
export interface ReuseUpdate {
  title: string;
  description: string | null;
  refreshed_at: Date;
  expires_at: Date;
  is_active: boolean;
  is_short?: boolean;
}

/**
 * Pure builder — quality-gate + field assembly for one card. Returns the
 * create/update payloads, or null when the card fails the quality gate (only
 * pool-worthy videos are reused). shortGate is injected so this stays DB-free
 * and unit-testable. Revival: update revives is_active (unless Short) and
 * restores title/description (a P0-scrubbed row has title='' → fresh live
 * restores it); source is deliberately omitted from update.
 */
export function prepareReuseRow(
  card: ReuseCard,
  fanoutById: ReuseInput['fanoutById'],
  metaById: ReuseInput['metaById'],
  language: 'ko' | 'en',
  shortGate: ShortGate
): { create: ReuseCreate; update: ReuseUpdate } | null {
  const verdict = classifyQuality({
    title: card.title,
    viewCount: card.viewCount,
    durationSec: card.durationSec,
  });
  if (!verdict.accepted || !verdict.tier) return null; // don't pool low-quality / missing-meta picks

  const description = (fanoutById.get(card.videoId)?.description ?? '').slice(0, 5000) || null;
  const likeRaw = metaById.get(card.videoId)?.statistics?.likeCount;
  const likeCount = likeRaw != null ? BigInt(likeRaw) : BigInt(0);
  const title = card.title.slice(0, 5000);
  const isShort = shortGate.is_short === true;

  return {
    create: {
      ...shortGate,
      video_id: card.videoId,
      title,
      description,
      channel_name: card.channelTitle?.slice(0, 200) || null,
      channel_id: card.channelId?.slice(0, 30) || null,
      view_count: card.viewCount != null ? BigInt(card.viewCount) : BigInt(0),
      like_count: likeCount,
      duration_seconds: card.durationSec,
      published_at: card.publishedAt ? new Date(card.publishedAt) : null,
      thumbnail_url: card.thumbnailUrl || null,
      language: language.slice(0, 5),
      quality_tier: verdict.tier,
      source: REUSE_SOURCE,
      is_active: !isShort,
      expires_at: ttlFromNow(),
    },
    update: {
      // Revive + restore scrubbed text + refresh freshness. NEVER touch source.
      title,
      description,
      refreshed_at: new Date(),
      expires_at: ttlFromNow(),
      is_active: !isShort, // short re-gate guard (don't revive a Short)
      ...(shortGate.is_short !== undefined ? { is_short: shortGate.is_short } : {}),
    },
  };
}

/**
 * Upsert picked cards back to video_pool. Fire-and-forget from the executor —
 * never awaited in the hot path. Returns counts for logging/tests.
 */
export async function reusePickedToPool(
  input: ReuseInput
): Promise<{ reused: number; skipped: number }> {
  const prisma = getPrismaClient();
  let reused = 0;
  let skipped = 0;
  for (const card of input.cards) {
    try {
      const shortGate = (await shortGateFields(card.videoId, card.durationSec)) as ShortGate;
      const row = prepareReuseRow(
        card,
        input.fanoutById,
        input.metaById,
        input.language,
        shortGate
      );
      if (!row) {
        skipped += 1;
        continue;
      }
      await prisma.video_pool.upsert({
        where: { video_id: card.videoId },
        create: row.create as unknown as Prisma.video_poolUncheckedCreateInput,
        update: row.update as unknown as Prisma.video_poolUncheckedUpdateInput,
      });
      reused += 1;
    } catch (err) {
      skipped += 1;
      log.warn(
        `reuse upsert failed for ${card.videoId}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
  log.info('reuse-loop done', { reused, skipped, source: REUSE_SOURCE });
  return { reused, skipped };
}
